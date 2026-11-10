// Start-up and moving between screens: first run; the four places, Home, the Library, the
// Glossary and Settings, joined by the navigation bar; the daily session and redo, and
// their summary; Import, Remove, the weekly report and Erase. The phone's Back follows
// history.js: from a place it goes Home, from a sub-screen to the screen it was opened
// from, and from a session it leaves the session, as End session does, without asking.
import { assembleDaily, assembleRedo } from '../engine/assemble.js';
import { catalogueOf } from '../engine/catalogue.js';
import { learnerDay } from '../engine/days.js';
import { recognise } from '../engine/formats.js';
import { emptyContent, planImport, planRemove, progressAfter } from '../engine/importing.js';
import { OVERVIEW_TEXT, overviewOf, reportDue, summaryLines } from '../engine/overview.js';
import { createPresentations } from '../engine/presentations.js';
import { SESSION_SECONDS, THEMES, checkName, newProgress, restoredProgress, stamped } from '../engine/progress.js';
import { buildReport } from '../engine/report.js';
import { canContinue, startSession } from '../engine/session.js';
import { checkStreak } from '../engine/streak.js';
import { APP_NAME } from './app-name.js';
import { questionScreen } from './dialogs.js';
import { filePicker, readPicked, saveFile } from './files.js';
import { bundleQuestionScreen, profileScreen } from './first-run.js';
import { glossaryScreen } from './glossary-screen.js';
import { createHistory } from './history.js';
import { homeScreen } from './home-screen.js';
import { confirmScreen, refusalScreen } from './import-flow.js';
import { libraryScreen } from './library-screen.js';
import { sessionRunner } from './session-runner.js';
import { settingsScreen } from './settings-screen.js';
import { appScope, openStorage } from './storage.js';
import { summaryScreen } from './summary-screen.js';
import { applyTheme } from './theme.js';

export const CONTROLLER_MESSAGES = {
  notSaved: "The change couldn't be saved, so nothing was changed. Close the app fully and try again.",
  nameSaved: 'Name saved.',
  reportShared: (name) => `Report shared: ${name}.`,
  reportDownloaded: (name) => `Report downloaded: ${name}.`,
  reportCancelled: 'The report was not saved.',
  eraseOffer: 'Save a report first? A report brings your progress back, on this phone or another.',
  eraseConfirm: "Erase everything on this phone? Your progress, settings and installed content are removed. This can't be undone.",
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
  applyTheme(progress ? progress.settings.theme : 'phone');
  let notice = null; // what was just done, shown once by the next place drawn
  let busy = false;
  let onlyReview = false; // the Library's filter

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

  function setContent(next) {
    content = next;
    catalogue = catalogueOf(next);
  }

  // Runs one change at a time, so a second tap can't apply it twice.
  const once =
    (work) =>
    async (...args) => {
      if (busy) return undefined;
      busy = true;
      try {
        return await work(...args);
      } finally {
        busy = false;
      }
    };

  // ------------------------------------------------------------------- levels and Back

  // levels[n] draws the screen at history level n; Home is level 0.
  const levels = [() => showHome()];
  let sessionLevel = null; // the level a running session sits at
  let pendingPlace = null; // a place to draw once Back has reached level 1

  const nav = createHistory((level) => {
    onBack(level);
  });

  async function onBack(level) {
    busy = false;
    if (sessionLevel !== null && level < sessionLevel) await leaveSession();
    levels.length = level + 1;
    if (pendingPlace && level === 1) {
      levels[1] = placeDrawing(pendingPlace);
      pendingPlace = null;
    }
    (levels[level] || levels[0])();
  }

  // A screen one level up, drawn now and again whenever Back returns to it.
  function open(draw) {
    nav.push();
    levels[nav.depth] = draw;
    draw();
  }

  // Another screen in place of the one at this level.
  function swap(draw) {
    levels[nav.depth] = draw;
    draw();
  }

  // Back by `count` levels; the screen there is drawn again, with `message` if it shows one.
  function back(message = null, count = 1) {
    notice = message;
    nav.back(count);
  }

  function placeDrawing(place) {
    const draw = { library: showLibrary, glossary: showGlossary, settings: showSettings }[place];
    return () => draw();
  }

  // The navigation bar: Home is the base, and the other places share the level above it.
  function goPlace(place) {
    if (place === 'home') {
      if (nav.depth > 0) back(null, nav.depth);
      else showHome();
    } else if (nav.depth === 0) open(placeDrawing(place));
    else if (nav.depth === 1) swap(placeDrawing(place));
    else {
      pendingPlace = place;
      back(null, nav.depth - 1);
    }
  }

  // ------------------------------------------------------------------------ the session

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
      sessionLevel = null;
      if (session.kind === 'daily') record = null;
      // Storage is asked to persist again at the first completed session.
      if (summary.firstCompleted) store().then((s) => s.persist());
      showSummary(summary, session, null);
    },
    onFailed: () => {
      sessionLevel = null;
      back(CONTROLLER_MESSAGES.notSaved);
    },
  });

  // Leaves a running session: what was being stored is stored, the time on screen saved
  // again, the second copy of the progress brought up to date, and an unfinished daily
  // session kept for Continue.
  async function leaveSession() {
    sessionLevel = null;
    const left = await runner.stop();
    if (!left) return;
    progress = left.progress;
    if (left.session.kind === 'daily' && left.session.index > 0) record = left.session;
    (await store()).mirror(progress);
  }

  function enterSession(session) {
    nav.push();
    sessionLevel = nav.depth;
    levels[sessionLevel] = () => {};
    runner.start({ progress, session });
  }

  // The streak and the counts are worked out again whenever the app comes back on screen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && nav.depth === 0 && sessionLevel === null && progress) showHome();
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
        notice = OVERVIEW_TEXT.nothingToStudy;
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
    enterSession(session);
  });

  function startRedo(lessonId) {
    const found = catalogue.lessons.get(lessonId);
    if (!found || !progress.position.lessonsCompleted.includes(lessonId)) return;
    enterSession(startSession({ kind: 'redo', plan: assembleRedo(found.lesson), day: learnerDay(clock), lessonId }, random));
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
          { label: 'End session', primary: true, onclick: () => back() },
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
        // A daily summary's third line counts the reviews that moved up a box.
        movedUp: summary.kind === 'daily' ? { count: summary.movedUp.length, after: 2 } : null,
        notice: message,
        report: due
          ? {
              line: OVERVIEW_TEXT.reportDue,
              onSave: once(async () => showSummary(summary, session, await saveReport())),
            }
          : null,
        onDone: () => back(),
      }),
    );
  }

  // --------------------------------------------------------------------------- the places

  // The streak check, and the discard of an unfinished session from an earlier day, each
  // stored before Home is drawn.
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
    if (nav.depth !== 0 || !progress) return;
    const message = notice;
    notice = null;
    show(
      homeScreen({
        title: (content.bundle && content.bundle.title) || APP_NAME,
        learner: progress.profile.name,
        streak: progress.streak,
        overview: overviewOf({ progress, catalogue, day: today, record }),
        notice: message,
        onSession: startDaily,
        onPlace: goPlace,
      }),
    );
  }

  function showLibrary() {
    const overview = overviewOf({ progress, catalogue, day: learnerDay(clock), record });
    show(
      libraryScreen({
        lessons: overview.lessons,
        trackStop: catalogue.order.stoppedAt ? OVERVIEW_TEXT.nextPackMissing : null,
        onlyReview,
        onFilter: () => {
          onlyReview = !onlyReview;
          showLibrary();
        },
        onRedo: startRedo,
        onPlace: goPlace,
      }),
    );
  }

  function showGlossary() {
    show(glossaryScreen({ glossary: content.glossary, onPlace: goPlace }));
  }

  function showSettings() {
    const message = notice;
    notice = null;
    show(
      settingsScreen({
        progress,
        content,
        version,
        address: appScope(),
        notice: message,
        onSaveName: saveName,
        onLength: chooseLength,
        onTheme: chooseTheme,
        onImport: chooseImport,
        onRemove: askRemove,
        onSaveReport: once(async () => {
          notice = await saveReport();
          showSettings();
        }),
        onErase: askErase,
        onPlace: goPlace,
      }),
    );
  }

  // A change made in Settings: written, then Settings drawn again with the line saying so.
  async function writeSetting(next, message = null) {
    try {
      await (await store()).writeProgress(next);
      progress = next;
      notice = message;
    } catch {
      notice = CONTROLLER_MESSAGES.notSaved;
    }
    if (nav.depth === 1) showSettings();
  }

  // Resolves with the problem to show, or null.
  const saveName = once(async (typed) => {
    const check = checkName(typed);
    if (!check.ok) return check.problem;
    if (check.name !== progress.profile.name) {
      await writeSetting(stamped({ ...progress, profile: { ...progress.profile, name: check.name } }, clock, version), CONTROLLER_MESSAGES.nameSaved);
    }
    return null;
  });

  const chooseLength = once(async (seconds) => {
    if (!SESSION_SECONDS.includes(seconds) || seconds === progress.settings.sessionSeconds) return;
    await writeSetting(stamped({ ...progress, settings: { ...progress.settings, sessionSeconds: seconds } }, clock, version));
  });

  const chooseTheme = once(async (theme) => {
    if (!THEMES.includes(theme) || theme === progress.settings.theme) return;
    applyTheme(theme);
    await writeSetting(stamped({ ...progress, settings: { ...progress.settings, theme } }, clock, version));
    applyTheme(progress.settings.theme); // as stored, so a failed write puts it back
  });

  function showProfile() {
    show(
      profileScreen({
        version,
        onDone: once(async ({ name }) => {
          const made = newProgress({ name }, clock, version, random);
          await (await store()).writeProgress(made);
          progress = made;
          applyTheme(progress.settings.theme);
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
      open(() => show(confirmScreen({ fileName: file.name, plan, onCancel: () => back(), onConfirm: once(() => install(file.name, plan)) })));
      return null;
    });
  }

  function refuse(fileName, message, more) {
    open(() => show(refusalScreen({ fileName, message, more, onClose: () => back() })));
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
        applyTheme(progress.settings.theme);
      } else {
        const next = progressAfter(progress, plan.nextContent, clock, version);
        await storage.applyContent(plan.writes, next);
        setContent(plan.nextContent);
        progress = next;
        storage.persist();
      }
      record = null;
    } catch {
      swap(() => show(refusalScreen({ fileName, message: CONTROLLER_MESSAGES.notSaved, more: 0, onClose: () => back() })));
      return;
    }
    back(plan.done);
  }

  function askRemove(packId) {
    const plan = planRemove(packId, content);
    open(() =>
      show(
        questionScreen({
          className: 'remove-question',
          lines: plan.lines,
          actions: [
            { label: 'Cancel', onclick: () => back() },
            {
              label: 'Remove',
              primary: true,
              onclick: once(async () => {
                const next = progressAfter(progress, plan.nextContent, clock, version);
                try {
                  await (await store()).applyContent(plan.writes, next);
                } catch {
                  back(CONTROLLER_MESSAGES.notSaved);
                  return;
                }
                setContent(plan.nextContent);
                progress = next;
                record = null;
                back(plan.done);
              }),
            },
          ],
        }),
      ),
    );
  }

  // ---------------------------------------------------------------------- the report

  // Builds the report and saves it. The marks go into progress only once the share or the
  // download has gone ahead. Returns the line saying what happened.
  async function saveReport() {
    const report = buildReport(progress, content, clock, version, APP_NAME);
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
    open(() =>
      show(
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
      ),
    );
  }

  function confirmErase(saved) {
    swap(() =>
      show(
        questionScreen({
          className: 'erase-confirm',
          heading: 'Erase this phone',
          lines: saved ? [saved, CONTROLLER_MESSAGES.eraseConfirm] : [CONTROLLER_MESSAGES.eraseConfirm],
          actions: [
            { label: 'Cancel', onclick: () => back() },
            {
              label: 'Erase',
              primary: true,
              onclick: once(async () => {
                await (await store()).erase();
                storage = null;
                setContent(emptyContent());
                progress = null;
                record = null;
                applyTheme('phone');
                back(null, nav.depth);
              }),
            },
          ],
        }),
      ),
    );
  }

  await showHome();
}
