// Start-up and moving between screens: first run, the start screen, the daily session and
// redo, the summary, Import, Remove, the weekly report and Erase. Every screen away from
// the start screen gets a history entry, so the phone's Back returns to it.
import { assembleDaily, assembleRedo } from '../engine/assemble.js';
import { catalogueOf } from '../engine/catalogue.js';
import { learnerDay } from '../engine/days.js';
import { recognise } from '../engine/formats.js';
import { emptyContent, planImport, planRemove, progressAfter } from '../engine/importing.js';
import { OVERVIEW_TEXT, overviewOf, reportDue, summaryLines } from '../engine/overview.js';
import { createPresentations } from '../engine/presentations.js';
import { SESSION_SECONDS, newProgress, restoredProgress, stamped } from '../engine/progress.js';
import { buildReport } from '../engine/report.js';
import { canContinue, startSession } from '../engine/session.js';
import { checkStreak } from '../engine/streak.js';
import { questionScreen } from './dialogs.js';
import { filePicker, readPicked, saveFile } from './files.js';
import { bundleQuestionScreen, profileScreen } from './first-run.js';
import { confirmScreen, refusalScreen } from './import-flow.js';
import { sessionRunner } from './session-runner.js';
import { startScreen } from './start-screen.js';
import { openStorage } from './storage.js';
import { summaryScreen } from './summary-screen.js';

export const CONTROLLER_MESSAGES = {
  notSaved: "The change couldn't be saved, so nothing was changed. Close the app fully and try again.",
  reportShared: (name) => `Report shared: ${name}.`,
  reportDownloaded: (name) => `Report downloaded: ${name}.`,
  reportCancelled: 'The report was not saved.',
  eraseOffer: 'Save a report first? A report brings your progress back, on this phone or another.',
  eraseConfirm: "Erase everything on this phone? Your progress, settings and installed content are removed. This can't be undone.",
  nothingToStudy: 'There is nothing to study right now.',
  endDaily: ['End this session for now?', "Your answers are saved, and you can continue it today. The day counts once a session is finished."],
  endRedo: ['End this redo?', 'Your answers are saved.'],
  sessionFinished: 'Session finished',
  redoFinished: 'Redo finished',
};

export async function startApp(root, { version, random, clock }) {
  let storage = await openStorage();
  let content = await storage.readContent();
  let catalogue = catalogueOf(content);
  let progress = await storage.readProgress(random);
  let record = await storage.readSession();
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

  function setContent(next) {
    content = next;
    catalogue = catalogueOf(next);
  }

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

  // ---------------------------------------------------------------------- the session

  const runner = sessionRunner({
    show,
    presentations,
    context: () => ({ catalogue, clock, engineVersion: version, random }),
    store: {
      writeAnswer: async (next, session) => (await store()).writeAnswer(next, session),
      // The summary reached. A daily session's record is cleared with the write; a redo
      // has none, and leaves any unfinished daily session as it is.
      finish: async (next, session) => (await store()).writeProgress(next, { clearSession: session.kind === 'daily' }),
    },
    onProgress: (next, session) => {
      progress = next;
      if (session.kind === 'daily') record = session;
    },
    onEnd: askEnd,
    onSummary: ({ summary, progress: next, session }) => {
      progress = next;
      if (session.kind === 'daily') record = null;
      // Storage is asked to persist again at the first completed session.
      if (summary.firstCompleted) store().then((s) => s.persist());
      showSummary(summary, session, null);
    },
    onFailed: () => home(CONTROLLER_MESSAGES.notSaved),
  });

  // Leaves a running session: what was being stored is stored, the second copy of the
  // progress is brought up to date, and an unfinished daily session stays for Continue.
  async function leaveSession() {
    const left = await runner.stop();
    if (!left) return;
    progress = left.progress;
    if (left.session.kind === 'daily' && left.session.index > 0) record = left.session;
    (await store()).mirror(progress);
  }

  window.addEventListener('popstate', async () => {
    if (!away) return;
    away = false;
    busy = false;
    await leaveSession();
    showHome();
  });

  // The streak and the counts are worked out again whenever the app comes back on screen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !away && progress) showHome();
  });

  const startDaily = once(async () => {
    const today = learnerDay(clock);
    const storage = await store();
    let session;
    if (canContinue(record, today)) {
      // Continuing uses the stored plan; nothing is assembled again.
      session = record;
    } else {
      const assembled = assembleDaily({ progress, catalogue, day: today, lastShown: await storage.presentations.lastShown(), random });
      if (assembled.plan.length === 0) {
        notice = CONTROLLER_MESSAGES.nothingToStudy;
        showHome();
        return;
      }
      if (assembled.catchingUp !== progress.position.catchingUp) {
        const next = stamped({ ...progress, position: { ...progress.position, catchingUp: assembled.catchingUp } }, clock, version);
        try {
          await storage.writeProgress(next);
        } catch {
          notice = CONTROLLER_MESSAGES.notSaved;
          showHome();
          return;
        }
        progress = next;
      }
      session = startSession({ kind: 'daily', plan: assembled.plan, day: today, lengthSec: assembled.lengthSec }, random);
    }
    leaveHome();
    runner.start({ progress, session });
  });

  function startRedo(lessonId) {
    const found = catalogue.lessons.get(lessonId);
    if (!found || !progress.position.lessonsCompleted.includes(lessonId)) return;
    const session = startSession({ kind: 'redo', plan: assembleRedo(found.lesson), day: learnerDay(clock), lessonId }, random);
    leaveHome();
    runner.start({ progress, session });
  }

  // End session asks first, on a screen of its own. Cancel puts the card back as it was.
  function askEnd(resume, kind) {
    show(
      questionScreen({
        className: 'end-question',
        heading: 'End session',
        lines: kind === 'redo' ? CONTROLLER_MESSAGES.endRedo : CONTROLLER_MESSAGES.endDaily,
        actions: [
          { label: 'Cancel', onclick: resume },
          { label: 'End session', primary: true, onclick: () => home() },
        ],
      }),
    );
  }

  function showSummary(summary, session, message) {
    const today = learnerDay(clock);
    const lesson = session.lessonId ? catalogue.lessons.get(session.lessonId) : null;
    const due = summary.kind === 'daily' && reportDue(progress, today);
    show(
      summaryScreen({
        kind: summary.kind,
        heading: summary.kind === 'redo' ? CONTROLLER_MESSAGES.redoFinished : CONTROLLER_MESSAGES.sessionFinished,
        title: lesson ? lesson.lesson.title : null,
        lines: summaryLines({ summary, progress, catalogue, day: today }),
        notice: message,
        report: due
          ? {
              line: OVERVIEW_TEXT.reportDue,
              onSave: once(async () => showSummary(summary, session, await saveReport())),
            }
          : null,
        onDone: () => home(),
      }),
    );
  }

  // --------------------------------------------------------------------- the start screen

  // The streak check, and the discard of an unfinished session from an earlier day, each
  // stored before the screen is drawn.
  async function settleToday() {
    const today = learnerDay(clock);
    const checked = checkStreak(progress.streak, today);
    if (checked !== progress.streak) {
      const next = stamped({ ...progress, streak: checked }, clock, version);
      await (await store()).writeProgress(next);
      progress = next;
    }
    if (record && !canContinue(record, today)) {
      await (await store()).clearSession();
      record = null;
    }
    return today;
  }

  async function showHome() {
    if (!progress) {
      showProfile();
      return;
    }
    let today;
    try {
      today = await settleToday();
    } catch {
      today = learnerDay(clock);
      notice = notice || CONTROLLER_MESSAGES.notSaved;
    }
    if (away || !progress) return;
    const screen = startScreen({
      progress,
      content,
      overview: overviewOf({ progress, catalogue, day: today, record }),
      version,
      notice,
      onSession: startDaily,
      onRedo: startRedo,
      onLength: once(async (seconds) => {
        if (!SESSION_SECONDS.includes(seconds) || seconds === progress.settings.sessionSeconds) return;
        const next = stamped({ ...progress, settings: { ...progress.settings, sessionSeconds: seconds } }, clock, version);
        try {
          await (await store()).writeProgress(next);
          progress = next;
        } catch {
          notice = CONTROLLER_MESSAGES.notSaved;
        }
        showHome();
      }),
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
          const made = newProgress(profile, clock, version, random);
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
      const plan = planImport(recognised, { content, progress, engineVersion: version, random });
      if (!plan.ok) return refuse(file.name, plan.message, plan.more);
      goAway(confirmScreen({ fileName: file.name, plan, onCancel: () => home(), onConfirm: once(() => install(file.name, plan)) }));
      return null;
    });
  }

  function refuse(fileName, message, more) {
    goAway(refusalScreen({ fileName, message, more, onClose: () => home() }));
  }

  // An import, a removal and a restore each discard an unfinished session with the write:
  // its plan may name cards that have gone, and its answers are already saved.
  async function install(fileName, plan) {
    try {
      const storage = await store();
      if (plan.kind === 'report') {
        const restored = restoredProgress(progress, plan.fromReport, clock, version);
        await storage.writeProgress(restored, { clearSession: true });
        progress = restored;
      } else {
        const next = progressAfter(progress, plan.nextContent, clock, version);
        await storage.applyContent(plan.writes, next);
        setContent(plan.nextContent);
        progress = next;
        storage.persist();
      }
      record = null;
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
              setContent(plan.nextContent);
              progress = next;
              record = null;
              home(plan.done);
            }),
          },
        ],
      }),
    );
  }

  // ---------------------------------------------------------------------- the report

  // Builds the report and saves it. The marks go into progress only once the share or the
  // download has gone ahead. Returns the line saying what happened.
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
              setContent(emptyContent());
              progress = null;
              record = null;
              home();
            }),
          },
        ],
      }),
    );
  }

  await showHome();
}
