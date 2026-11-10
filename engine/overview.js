// What Home and the summary say, worked out from the progress and the content: the lessons
// and whether each is completed, current or locked; how many reviews are due; the one
// notice line, which says why when there is nothing to study; which session the large
// button offers; when the next review is due; and whether a weekly report is due. Learners
// read of cards, reviews, lessons, packs and terms, never of atoms.

import { addDays, daysBetween, longDate } from './days.js';
import { currentLessonId } from './lessons.js';
import { backlog, dueList, isDue, notYetDue, reachableCards } from './schedule.js';
import { canContinue } from './session.js';

export const REPORT_EVERY_DAYS = 7;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const OVERVIEW_TEXT = {
  start: "Start today's session",
  continue: "Continue today's session",
  another: 'Start another session',
  dueToday: (count) => `${plural(count, 'review', 'reviews')} due today`,
  catchingUp: (count) => `Catching up first — ${count} to clear.`,
  nextPackMissing: "The next pack in your track isn't installed yet.",
  trackDone: 'Every lesson in your track is done.',
  allDone: 'Every installed lesson is done.',
  nothingInstalled: 'Nothing installed yet. Import a bundle in Settings.',
  noLessons: 'No lessons installed yet. Import a bundle in Settings.',
  nothingToStudy: 'There is nothing to study right now.',
  updateReady: (version) => `Version ${version} is ready. Restart to use it.`,
  reportDue: 'Your weekly report is due.',
};

// True when nothing at all is installed on the phone.
const nothingInstalled = (installed) =>
  !installed || (!installed.bundleId && !installed.trackId && !installed.glossaryVersion && Object.keys(installed.packs || {}).length === 0);

// The lessons in study order, each completed, current or locked (spec §5.7). Only the
// current lesson and those before it are open: a completed lesson can be redone, the
// current one is played through the daily session, and a locked one shows its title only.
export function lessonStates(catalogue, position) {
  const completed = new Set(position.lessonsCompleted);
  const current = currentLessonId(catalogue.order, position);
  return catalogue.order.lessons.map((entry, i) => ({
    lessonId: entry.lesson.lessonId,
    title: entry.lesson.title || '',
    number: i + 1,
    packId: entry.packId,
    packTitle: entry.packTitle,
    needsReview: entry.lesson.needsReview === true,
    state: completed.has(entry.lesson.lessonId) ? 'completed' : entry.lesson.lessonId === current ? 'current' : 'locked',
  }));
}

// Home's facts for this progress and content on this day. `record` is the stored session,
// if any.
//   lessons   lessonStates
//   place     { number, total, title } for the current lesson, or null
//   dueCount  the reviews due today, and dueText, the same in words: "3 reviews due today"
//   notice    the one notice line, or null, and noticeKind, which it is: 'catching-up',
//             'next-pack' or 'all-done'; or, with nothing to study, why: 'nothing-installed',
//             'no-lessons' or 'nothing-to-study'
//   action   'continue', 'start', 'another', or null when there is nothing to study
//   label     the large button's words
export function overviewOf({ progress, catalogue, day, record }) {
  const { position, streak } = progress;
  const lessons = lessonStates(catalogue, position);
  const current = lessons.find((lesson) => lesson.state === 'current') || null;
  const due = dueList(progress, catalogue, day);
  const catchingUp = backlog(due.length, position.catchingUp);
  const lesson = current ? catalogue.lessons.get(current.lessonId).lesson : null;
  const newLeft = lesson !== null && position.currentCardIndex < lesson.cards.length;

  let notice = null;
  let noticeKind = null;
  if (catchingUp) [noticeKind, notice] = ['catching-up', OVERVIEW_TEXT.catchingUp(due.length)];
  else if (catalogue.order.stoppedAt) [noticeKind, notice] = ['next-pack', OVERVIEW_TEXT.nextPackMissing];
  else if (lessons.length > 0 && !current) [noticeKind, notice] = ['all-done', progress.installed.trackId ? OVERVIEW_TEXT.trackDone : OVERVIEW_TEXT.allDone];

  let action = null;
  if (canContinue(record, day)) action = 'continue';
  else if (due.length > 0 || newLeft || notYetDue(progress, catalogue, day).length > 0) {
    // After the day's session, the button offers another one.
    action = streak.lastCountedDay === day ? 'another' : 'start';
  }

  // With nothing to study there is no button, and the notice line says why.
  if (action === null && notice === null) {
    if (nothingInstalled(progress.installed)) [noticeKind, notice] = ['nothing-installed', OVERVIEW_TEXT.nothingInstalled];
    else if (lessons.length === 0) [noticeKind, notice] = ['no-lessons', OVERVIEW_TEXT.noLessons];
    else [noticeKind, notice] = ['nothing-to-study', OVERVIEW_TEXT.nothingToStudy];
  }

  return {
    lessons,
    place: current ? { number: current.number, total: lessons.length, title: current.title } : null,
    dueCount: due.length,
    dueText: OVERVIEW_TEXT.dueToday(due.length),
    catchingUp,
    notice,
    noticeKind,
    action,
    label: action ? OVERVIEW_TEXT[action] : null,
  };
}

// The earliest day on which an atom with a reachable card is due, or null with no atoms.
export function nextReviewDay(progress, catalogue) {
  let earliest = null;
  for (const key of reachableCards(catalogue, progress.position).keys()) {
    const atom = progress.atoms[key];
    if (atom && (earliest === null || daysBetween(atom.dueOn, earliest) > 0)) earliest = atom.dueOn;
  }
  return earliest;
}

// A weekly report is due seven days after the last one or, for the first report, seven
// days after the first session.
export function reportDue(progress, day) {
  const saved = progress.reportsSavedOn.filter((d) => daysBetween(d, day) >= 0).sort();
  if (saved.length > 0) return daysBetween(saved[saved.length - 1], day) >= REPORT_EVERY_DAYS;
  const sessions = progress.sessionLog.map((entry) => entry && entry.day).filter((d) => typeof d === 'string').sort();
  return sessions.length > 0 && daysBetween(sessions[0], day) >= REPORT_EVERY_DAYS;
}

// The summary screen's lines, in order, for a summary from session.completeSession and
// the progress after it. A redo's summary leaves out the reviews moved up and the streak.
// Only a due atom answered right moves up a box, so "review" is the exact word for it.
export function summaryLines({ summary, progress, catalogue, day }) {
  const lines = [`${plural(summary.cards, 'card', 'cards')} seen.`];
  lines.push(
    summary.answered > 0
      ? `${summary.correct} of ${plural(summary.answered, 'answer', 'answers')} correct, ${Math.round((summary.correct / summary.answered) * 100)}%.`
      : 'No answers.',
  );
  if (summary.kind === 'daily') {
    const moved = summary.movedUp.length;
    lines.push(moved === 0 ? 'No reviews moved up a box.' : `${plural(moved, 'review', 'reviews')} moved up a box.`);
  }
  const [cleared, shown] = summary.traps;
  lines.push(shown === 0 ? 'No traps.' : `${cleared} of ${plural(shown, 'trap', 'traps')} cleared.`);
  if (summary.streak) lines.push(`Streak ${summary.streak.current}, longest ${summary.streak.longest}, freezes left ${summary.streak.freezesRemaining}.`);
  const next = nextReviewDay(progress, catalogue);
  if (next !== null) {
    if (isDue({ dueOn: next }, day)) {
      const still = dueList(progress, catalogue, day).length;
      lines.push(`${plural(still, 'review is', 'reviews are')} still due today.`);
    } else if (next === addDays(day, 1)) lines.push('The next review is due tomorrow.');
    else lines.push(`The next review is due on ${longDate(next)}.`);
  }
  return lines;
}
