// Start-up and moving between screens: first run, the start screen, Import, Remove, the
// weekly report, Erase and the lessons. Every screen away from the start screen gets a
// history entry, so the phone's Back returns to it.
import { recognise } from '../engine/formats.js';
import { emptyContent, planImport, planRemove, progressAfter } from '../engine/importing.js';
import { currentLessonId, lessonOrder } from '../engine/lessons.js';
import { createPresentations } from '../engine/presentations.js';
import { newProgress, restoredProgress } from '../engine/progress.js';
import { buildReport } from '../engine/report.js';
import { questionScreen } from './dialogs.js';
import { filePicker, readPicked, saveFile } from './files.js';
import { bundleQuestionScreen, profileScreen } from './first-run.js';
import { confirmScreen, refusalScreen } from './import-flow.js';
import { lessonPlayer } from './player.js';
import { startScreen } from './start-screen.js';
import { openStorage } from './storage.js';

export const CONTROLLER_MESSAGES = {
  notSaved: "The change couldn't be saved, so nothing was changed. Close the app fully and try again.",
  reportShared: (name) => `Report shared: ${name}.`,
  reportDownloaded: (name) => `Report downloaded: ${name}.`,
  reportCancelled: 'The report was not saved.',
  eraseOffer: 'Save a report first? A report brings your progress back, on this phone or another.',
  eraseConfirm: "Erase everything on this phone? Your progress, settings and installed content are removed. This can't be undone.",
};

export async function startApp(root, { version, random, clock }) {
  let storage = await openStorage();
  let content = await storage.readContent();
  let progress = await storage.readProgress();
  let away = false;
  let notice = null;
  let busy = false;

  // Erase closes the database; it opens again only when there is something to keep.
  const store = async () => {
    if (!storage) storage = await openStorage();
    return storage;
  };
  const presentations = createPresentations(
    {
      get: async (key) => (await store()).presentations.get(key),
      put: async (key, value) => (await store()).presentations.put(key, value),
    },
    clock,
  );

  const picker = filePicker();

  function show(screen) {
    root.replaceChildren(screen);
    window.scrollTo(0, 0);
  }

  function leaveHome() {
    if (!away) {
      history.pushState({ away: true }, '');
      away = true;
    }
  }

  function goAway(screen) {
    leaveHome();
    show(screen);
  }

  // Back to the start screen, with a line saying what was done.
  function home(message = null) {
    notice = message;
    if (away) history.back();
    else showHome();
  }

  const player = lessonPlayer({ show, presentations, random, onLessons: () => home() });

  window.addEventListener('popstate', () => {
    if (!away) return;
    away = false;
    busy = false;
    player.stop();
    showHome();
  });

  // Runs one change at a time, so a second tap can't apply it twice.
  const once =
    (work) =>
    async (...args) => {
      if (busy) return;
      busy = true;
      try {
        await work(...args);
      } finally {
        busy = false;
      }
    };

  function showHome() {
    if (!progress) {
      showProfile();
      return;
    }
    const order = lessonOrder(content);
    const screen = startScreen({
      progress,
      content,
      order,
      currentId: currentLessonId(order, progress.position),
      version,
      notice,
      onLesson: (entry) => {
        leaveHome();
        player.play(entry.lesson);
      },
      onImport: chooseImport,
      onRemove: askRemove,
      onSaveReport: once(async () => {
        notice = await saveReport();
        showHome();
      }),
      onErase: askErase,
    });
    notice = null;
    show(screen);
  }

  function showProfile() {
    show(
      profileScreen({
        version,
        onDone: once(async (profile) => {
          const made = newProgress(profile, clock, version);
          await (await store()).writeProgress(made);
          progress = made;
          show(bundleQuestionScreen({ onImport: chooseImport, onSkip: () => showHome() }));
        }),
      }),
    );
  }

  // ---------------------------------------------------------------------------- import

  function chooseImport() {
    picker.choose(async (file) => {
      const read = await readPicked(file);
      if (!read.ok) return refuse(file.name, read.message, 0);
      const recognised = recognise(read.text);
      if (!recognised.kind) return refuse(file.name, recognised.message, 0);
      const plan = planImport(recognised, { content, progress, engineVersion: version });
      if (!plan.ok) return refuse(file.name, plan.message, plan.more);
      goAway(confirmScreen({ fileName: file.name, plan, onCancel: () => home(), onConfirm: once(() => install(file.name, plan)) }));
      return null;
    });
  }

  function refuse(fileName, message, more) {
    goAway(refusalScreen({ fileName, message, more, onClose: () => home() }));
  }

  async function install(fileName, plan) {
    try {
      const storage = await store();
      if (plan.kind === 'report') {
        const restored = restoredProgress(progress, plan.fromReport, clock, version);
        await storage.writeProgress(restored);
        progress = restored;
      } else {
        const next = progressAfter(progress, plan.nextContent, clock, version);
        await storage.applyContent(plan.writes, next);
        content = plan.nextContent;
        progress = next;
        storage.persist();
      }
    } catch {
      refuse(fileName, CONTROLLER_MESSAGES.notSaved, 0);
      return;
    }
    home(plan.done);
  }

  function askRemove(packId) {
    const plan = planRemove(packId, content);
    goAway(
      questionScreen({
        className: 'remove-question',
        lines: plan.lines,
        actions: [
          { label: 'Cancel', onclick: () => home() },
          {
            label: 'Remove',
            primary: true,
            onclick: once(async () => {
              const next = progressAfter(progress, plan.nextContent, clock, version);
              try {
                await (await store()).applyContent(plan.writes, next);
              } catch {
                home(CONTROLLER_MESSAGES.notSaved);
                return;
              }
              content = plan.nextContent;
              progress = next;
              home(plan.done);
            }),
          },
        ],
      }),
    );
  }

  // ---------------------------------------------------------------------- the report

  // Builds the report and saves it. The marks go into progress only once the share or the
  // download has gone ahead. Returns the line for the start screen.
  async function saveReport() {
    const report = buildReport(progress, content, clock, version);
    const file = new File([report.text], report.fileName, { type: 'text/markdown' });
    const how = await saveFile(file);
    if (how === 'cancelled') return CONTROLLER_MESSAGES.reportCancelled;
    try {
      await (await store()).writeProgress(report.marked);
      progress = report.marked;
    } catch {
      return CONTROLLER_MESSAGES.notSaved;
    }
    return how === 'shared' ? CONTROLLER_MESSAGES.reportShared(report.fileName) : CONTROLLER_MESSAGES.reportDownloaded(report.fileName);
  }

  // ---------------------------------------------------------------------------- erase

  function askErase() {
    goAway(
      questionScreen({
        className: 'erase-offer',
        heading: 'Erase this phone',
        lines: [CONTROLLER_MESSAGES.eraseOffer],
        actions: [
          { label: 'Skip', onclick: () => confirmErase(null) },
          {
            label: 'Save report',
            primary: true,
            onclick: once(async () => {
              const saved = await saveReport();
              if (saved !== CONTROLLER_MESSAGES.reportCancelled) confirmErase(saved);
            }),
          },
        ],
      }),
    );
  }

  function confirmErase(saved) {
    show(
      questionScreen({
        className: 'erase-confirm',
        heading: 'Erase this phone',
        lines: saved ? [saved, CONTROLLER_MESSAGES.eraseConfirm] : [CONTROLLER_MESSAGES.eraseConfirm],
        actions: [
          { label: 'Cancel', onclick: () => home() },
          {
            label: 'Erase',
            primary: true,
            onclick: once(async () => {
              await (await store()).erase();
              storage = null;
              content = emptyContent();
              progress = null;
              home();
            }),
          },
        ],
      }),
    );
  }

  showHome();
}
