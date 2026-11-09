// Spaced repetition (spec §4): five boxes with growing intervals, what an answer does to
// an atom, which card tests an atom at a review, the atoms due on a day, and the cap that
// keeps a long absence from turning into a wall of reviews.
//
// Everything here is a pure function of its arguments: the day, the time and the random
// source come in from the caller.

import { addDays, daysBetween } from './days.js';
import { currentLessonId } from './lessons.js';

export const INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 21, 5: 60 };
export const TOP_BOX = 5;
export const TRAP_TOP_BOX = 4;
export const MAX_REVIEWS = 20;
export const BACKLOG_ON_ABOVE = 40;
export const BACKLOG_OFF_BELOW = 20;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// In boxes 3, 4 and 5 the due day moves by -1, 0 or +1 day, so reviews don't clump.
const jitter = (box, random) => (box >= 3 ? random.below(3) - 1 : 0);

// True when the atom is due on that day: its due day is that day or earlier.
export const isDue = (atom, day) => daysBetween(atom.dueOn, day) >= 0;

// What an answer does to an atom (spec §4.2).
//   atom     the atom's entry in progress, or null when it has never been met
//   answer   { correct, cardId, day, stamp, kind, reAsk, early, trapAtom }
//            day       the learner's day of the answer
//            stamp     the time of the answer, written with its offset
//            kind      'daily' or 'redo'
//            reAsk     the card is being asked again in the same session
//            early     the card is an early review
//            trapAtom  one of the atom's cards is a trap card
// Returns { atom, introduced, movedUp }: the entry after the answer, whether this answer
// met the atom for the first time, and whether it moved up a box.
export function answerAtom(atom, answer, random) {
  const { correct, cardId, day, stamp, kind, reAsk = false, early = false, trapAtom = false } = answer;
  const before = isObject(atom) ? atom : null;
  const tomorrow = addDays(day, 1);

  let box = before ? before.box : 1;
  let dueOn = before ? before.dueOn : tomorrow;
  let lastPromotedOn = before ? before.lastPromotedOn ?? null : null;
  let movedUp = false;

  if (!before) {
    // Met for the first time, in any session: box 1, due tomorrow. Not a promotion.
    box = 1;
    dueOn = tomorrow;
  } else if (!correct) {
    // A wrong answer demotes in every context.
    box = 1;
    dueOn = tomorrow;
  } else if (
    kind === 'daily' &&
    !reAsk &&
    !early &&
    isDue(before, day) &&
    before.lastSeenOn !== day &&
    lastPromotedOn !== day
  ) {
    // A due atom's first answer of the day, in a daily session: up one box. A late review
    // keeps its box, and the next interval counts from today.
    box = Math.min(before.box + 1, trapAtom ? TRAP_TOP_BOX : TOP_BOX);
    dueOn = addDays(day, INTERVAL_DAYS[box] + jitter(box, random));
    lastPromotedOn = day;
    movedUp = box > before.box;
  }

  let lastMissedCardId = before ? before.lastMissedCardId ?? null : null;
  if (!correct) lastMissedCardId = cardId;
  else if (kind === 'daily' && !reAsk && lastMissedCardId === cardId) lastMissedCardId = null;

  return {
    atom: {
      box,
      dueOn,
      introducedOn: before && before.introducedOn ? before.introducedOn : day,
      lastSeenOn: day,
      lastPromotedOn,
      correctStreak: correct ? ((before && before.correctStreak) || 0) + 1 : 0,
      wrongStreak: correct ? 0 : ((before && before.wrongStreak) || 0) + 1,
      totalSeen: ((before && before.totalSeen) || 0) + 1,
      totalWrong: ((before && before.totalWrong) || 0) + (correct ? 0 : 1),
      lastMissedCardId,
      trap: trapAtom === true,
      changedAt: stamp,
    },
    introduced: !before,
    movedUp,
  };
}

// The cards a review may use (spec §4.3): the testable cards of lessons the learner has
// completed, and of the current lesson before the current card. Map key -> entries, in
// file order.
export function reachableCards(catalogue, position) {
  const completed = new Set(Array.isArray(position.lessonsCompleted) ? position.lessonsCompleted : []);
  const current = currentLessonId(catalogue.order, position);
  const reachable = new Map();
  for (const [key, entries] of catalogue.atoms) {
    const open = entries.filter(
      (entry) => completed.has(entry.lessonId) || (entry.lessonId === current && entry.index < position.currentCardIndex),
    );
    if (open.length > 0) reachable.set(key, open);
  }
  return reachable;
}

// The card that tests an atom at a review: the card last missed, when it can be reached;
// otherwise the reachable card presented longest ago, a card never presented coming
// first, then file order. `lastShown` maps a card id to when it was last shown.
export function cardForAtom(atom, entries, lastShown) {
  if (!entries || entries.length === 0) return null;
  const missed = isObject(atom) && atom.lastMissedCardId != null ? entries.find((e) => e.card.cardId === atom.lastMissedCardId) : null;
  if (missed) return missed;
  return longestAgo(entries, lastShown);
}

// Of these cards, the one presented longest ago: never presented first, then file order.
export function longestAgo(entries, lastShown) {
  const shown = (entry) => {
    const at = lastShown ? lastShown.get(entry.card.cardId) : undefined;
    return typeof at === 'number' ? at : Number.NEGATIVE_INFINITY;
  };
  return entries.slice().sort((a, b) => shown(a) - shown(b) || a.seq - b.seq)[0] || null;
}

// The atoms due on a day that have a reachable card, the most overdue first; ties go to
// the lower box, then to the key (spec §4.4). An atom with a reachable card and no entry
// in progress has not been introduced yet: it counts as due today, ranked as if in box 1.
// Returns [{ key, atom, entries, overdue, box }], atom being null before it is introduced.
export function dueList(progress, catalogue, day) {
  const due = [];
  for (const [key, entries] of reachableCards(catalogue, progress.position)) {
    const atom = isObject(progress.atoms[key]) ? progress.atoms[key] : null;
    if (!atom) due.push({ key, atom: null, entries, overdue: 0, box: 1 });
    else if (isDue(atom, day)) due.push({ key, atom, entries, overdue: daysBetween(atom.dueOn, day), box: atom.box });
  }
  return due.sort((a, b) => b.overdue - a.overdue || a.box - b.box || byKey(a.key, b.key));
}

// The atoms not yet due that have a reachable card, the soonest due first; ties as above.
// These are the candidates for early reviews (spec §5.2).
export function notYetDue(progress, catalogue, day) {
  const later = [];
  for (const [key, entries] of reachableCards(catalogue, progress.position)) {
    const atom = isObject(progress.atoms[key]) ? progress.atoms[key] : null;
    if (atom && !isDue(atom, day)) later.push({ key, atom, entries, box: atom.box });
  }
  return later.sort((a, b) => daysBetween(b.atom.dueOn, a.atom.dueOn) || a.box - b.box || byKey(a.key, b.key));
}

// The backlog switch: on when more than 40 atoms are due as a daily session is assembled,
// and off again only when one starts with fewer than 20 due.
export function backlog(dueCount, catchingUp) {
  if (dueCount > BACKLOG_ON_ABOVE) return true;
  if (dueCount < BACKLOG_OFF_BELOW) return false;
  return catchingUp === true;
}
