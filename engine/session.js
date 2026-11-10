// A session as it runs (spec §5): the card that comes next or the cut-off, where a missed
// card is asked again, what one answer changes, and the end.
//
// The session is one plain object, the record the phone stores for an unfinished daily
// session (§5.5):
//   { id, kind, day, lengthSec, lessonId, plan, index, elapsedSec, passed, reAsks,
//     nextBlock, movedUp }
//   kind        'daily' or 'redo'
//   day         the learner's day the session started on
//   lengthSec   the budget B, or 0 for a redo, which has no length
//   lessonId    the lesson being redone, or null
//   plan        the items of assemble.js, with re-asks added as they are placed
//   index       how far it has got: the place in the plan of the card to show next
//   elapsedSec  the time on screen so far, measured by the page
//   passed      for every card passed, { cardId, lists, answer, correct }: the order its
//               lists were shown in and the answer given; correct is null for a teach card
//   reAsks      how many times each card has been asked again
//   movedUp     the atoms that moved up a box
//
// Every function returns new objects and changes nothing it is given, so one answer's
// writes are built as one change and stored in one transaction.

import { OVERRUN_SECONDS } from './assemble.js';
import { estimateOf } from './catalogue.js';
import { confusedPairs, recordConfusions } from './confusions.js';
import { learnerDay, localStamp } from './days.js';
import { newId } from './ids.js';
import { positionAfterCompleting } from './lessons.js';
import { stamped } from './progress.js';
import { answerAtom } from './schedule.js';
import { countDay } from './streak.js';

export const MAX_RE_ASKS = 2; // per card, per session
export const RE_ASK_GAP = 3; // a re-ask comes at least three cards later
export const RECENT_ANSWERS = 30; // kept per family
export const SESSION_LOG_MAX = 90;

const cardOf = (catalogue, item) => catalogue.cards.get(item.cardId) || null;
const seconds = (catalogue, items) => items.reduce((sum, item) => sum + estimateOf(cardOf(catalogue, item)?.card), 0);

// A session about to start.
export function startSession({ kind, plan, day, lengthSec = 0, lessonId = null }, random) {
  return {
    id: newId(random),
    kind,
    day,
    lengthSec: kind === 'redo' ? 0 : lengthSec,
    lessonId,
    plan,
    index: 0,
    elapsedSec: 0,
    passed: [],
    reAsks: {},
    nextBlock: plan.reduce((max, item) => Math.max(max, item.block), -1) + 1,
    movedUp: [],
  };
}

// True when the stored record is today's unfinished daily session, which the start screen
// offers to continue. A record from another day is discarded.
export const canContinue = (record, day) => Boolean(record) && record.kind === 'daily' && record.day === day && Array.isArray(record.plan);

// What comes next: { done: false, item, where } with the card to show, or { done: true,
// reason } with 'end' after the last card and 'time' at the cut-off (spec §5.1). A card is
// never started if the time so far plus its estimate would pass B + 120 seconds. New
// material is judged a block at a time, at the block's first card, so a teach card is
// never left without the test after it. A redo has no length.
export function nextStep(session, catalogue, elapsedSec) {
  const item = session.plan[session.index];
  if (!item) return { done: true, reason: 'end' };
  const where = cardOf(catalogue, item);
  if (!where) return { done: true, reason: 'end' };
  if (session.kind === 'daily') {
    const blockStart = session.index === 0 || session.plan[session.index - 1].block !== item.block;
    if (blockStart) {
      let end = session.index;
      while (end < session.plan.length && session.plan[end].block === item.block) end++;
      if (elapsedSec + seconds(catalogue, session.plan.slice(session.index, end)) > session.lengthSec + OVERRUN_SECONDS) {
        return { done: true, reason: 'time' };
      }
    }
  }
  return { done: false, item, where };
}

// Where the card just answered wrong is asked again (spec §5.4): one of the places at
// least three cards later, at a block boundary, not after the final desk card, and, in a
// daily session, only where the rest of the plan with the re-ask added still fits within
// B + 120 seconds. Returns the place in the plan, or null when there is none or the card
// has already been asked again twice.
export function reAskPlace(session, catalogue, elapsedSec, random) {
  const { plan, index } = session;
  const item = plan[index];
  if ((session.reAsks[item.cardId] || 0) >= MAX_RE_ASKS) return null;
  if (session.kind === 'daily') {
    const rest = seconds(catalogue, plan.slice(index + 1)) + seconds(catalogue, [item]);
    if (elapsedSec + rest > session.lengthSec + OVERRUN_SECONDS) return null;
  }
  const final = plan.findIndex((x) => x.final === true);
  const last = final >= 0 ? final : plan.length;
  const places = [];
  for (let place = index + RE_ASK_GAP; place <= last; place++) {
    if (place === plan.length || plan[place - 1].block !== plan[place].block) places.push(place);
  }
  return places.length > 0 ? places[random.below(places.length)] : null;
}

// How many cards of each kind have been shown among the first `count` items of the plan:
// the cards of new material, the re-asks, and the other cards.
function shownCounts(plan, count) {
  const shown = plan.slice(0, count);
  const reAsks = shown.filter((item) => item.reAsk === true).length;
  const newCards = shown.filter((item) => item.part === 'new' && item.reAsk !== true).length;
  return { newCards, reAsks, reviewCards: shown.length - newCards - reAsks };
}

const emptyEntry = (session) => ({
  id: session.id,
  day: session.day,
  kind: session.kind,
  lengthSec: session.lengthSec,
  durationSec: 0,
  newCards: 0,
  reviewCards: 0,
  reAsks: 0,
  answered: 0,
  correct: 0,
  traps: [0, 0],
  families: {},
  completed: false,
});

// The session log with this session's entry changed by `change`, and made first if it
// isn't there yet. The log keeps its latest 90 entries.
function withEntry(sessionLog, session, change) {
  const log = Array.isArray(sessionLog) ? sessionLog : [];
  const at = log.findIndex((entry) => entry && entry.id === session.id);
  if (at >= 0) return log.map((entry, i) => (i === at ? change(entry) : entry));
  return [...log, change(emptyEntry(session))].slice(-SESSION_LOG_MAX);
}

// The position after a card of the current lesson is answered or read in a daily session:
// past that card, and on to the next lesson when it was the lesson's last.
function positionPast(position, catalogue, where) {
  const lesson = catalogue.lessons.get(where.lessonId).lesson;
  const next = Math.max(where.index + 1, position.currentLesson === where.lessonId ? position.currentCardIndex : 0);
  if (next >= lesson.cards.length) return positionAfterCompleting(position, catalogue.order, where.lessonId);
  return { ...position, currentLesson: where.lessonId, currentCardIndex: next };
}

const movesPosition = (session, item) => session.kind === 'daily' && item.part === 'new' && item.reAsk !== true;

// One answer, as one change (spec §9.3, rule 1).
//   state   { progress, session }
//   given   { score, answer, lists, elapsedSec }: the result of scoring.scoreAnswer, the
//           answer as given, the order the card's lists were shown in, and the time on
//           screen so far
//   ctx     { catalogue, clock, engineVersion, random }
// Returns { progress, session, movedUp, reAsked }. The progress holds everything the
// answer changes: the atom, the family's recent results, any confusion, the session's log
// entry, the position and the time saved. The session has moved on one card, with the
// re-ask placed after a wrong answer.
export function applyAnswer({ progress, session }, { score, answer, lists, elapsedSec }, { catalogue, clock, engineVersion, random }) {
  const item = session.plan[session.index];
  const where = cardOf(catalogue, item);
  const { card } = where;
  const day = learnerDay(clock);
  const correct = score.correct === true;
  const key = card.srsKey;

  const result = answerAtom(
    progress.atoms[key],
    {
      correct,
      cardId: card.cardId,
      day,
      stamp: localStamp(clock),
      kind: session.kind,
      reAsk: item.reAsk === true,
      early: item.part === 'early',
      trapAtom: catalogue.trapAtoms.has(key),
    },
    random,
  );

  const family = catalogue.familyOf(card);
  const families = family
    ? { ...progress.families, [family]: { recent: [...((progress.families[family] && progress.families[family].recent) || []), correct ? 1 : 0].slice(-RECENT_ANSWERS) } }
    : progress.families;

  const place = correct ? null : reAskPlace(session, catalogue, elapsedSec, random);
  const plan =
    place === null
      ? session.plan
      : [...session.plan.slice(0, place), { cardId: item.cardId, part: item.part, block: session.nextBlock, final: false, reAsk: true }, ...session.plan.slice(place)];

  const index = session.index + 1;
  const duration = Math.round(elapsedSec);
  const sessionLog = withEntry(progress.sessionLog, session, (entry) => ({
    ...entry,
    durationSec: duration,
    ...shownCounts(plan, index),
    answered: entry.answered + 1,
    correct: entry.correct + (correct ? 1 : 0),
    traps: card.trap === true ? [entry.traps[0] + (correct ? 1 : 0), entry.traps[1] + 1] : entry.traps,
    families: family ? { ...entry.families, [family]: [((entry.families[family] || [])[0] || 0) + 1, ((entry.families[family] || [])[1] || 0) + (correct ? 1 : 0)] } : entry.families,
  }));

  return {
    progress: stamped(
      {
        ...progress,
        atoms: { ...progress.atoms, [key]: result.atom },
        families,
        confusions: recordConfusions(progress.confusions, confusedPairs(card, score), day),
        sessionLog,
        position: movesPosition(session, item) ? positionPast(progress.position, catalogue, where) : progress.position,
      },
      clock,
      engineVersion,
    ),
    session: {
      ...session,
      plan,
      index,
      elapsedSec: duration,
      passed: [...session.passed, { cardId: card.cardId, lists, answer, correct }],
      reAsks: place === null ? session.reAsks : { ...session.reAsks, [item.cardId]: (session.reAsks[item.cardId] || 0) + 1 },
      nextBlock: place === null ? session.nextBlock : session.nextBlock + 1,
      movedUp: result.movedUp && !session.movedUp.includes(key) ? [...session.movedUp, key] : session.movedUp,
    },
    movedUp: result.movedUp,
    reAsked: place !== null,
  };
}

// A teach card read and passed. In a daily session the position moves past it, so an
// interrupted session picks up where it stopped. Returns { progress, session, changed }:
// `changed` says whether the progress is a new one to store.
export function applyTeach({ progress, session }, { elapsedSec }, { catalogue, clock, engineVersion }) {
  const item = session.plan[session.index];
  const where = cardOf(catalogue, item);
  const next = {
    ...session,
    index: session.index + 1,
    elapsedSec: Math.round(elapsedSec),
    passed: [...session.passed, { cardId: item.cardId, lists: {}, answer: null, correct: null }],
  };
  if (!movesPosition(session, item)) return { progress, session: next, changed: false };
  return {
    progress: stamped({ ...progress, position: positionPast(progress.position, catalogue, where) }, clock, engineVersion),
    session: next,
    changed: true,
  };
}

// The time on screen saved again as a session is left without its summary: at End session
// or by the phone's Back (spec §5.1). The session's log entry, made at its first answer,
// takes the time, and so does the session record. A session left before its first card is
// passed has nothing to keep. Returns { progress, session, changed }: `changed` says
// whether there is anything new to store.
export function noteTimeOnScreen({ progress, session }, { elapsedSec }, { clock, engineVersion }) {
  const duration = Math.round(elapsedSec);
  if (session.index === 0) return { progress, session, changed: false };
  const log = Array.isArray(progress.sessionLog) ? progress.sessionLog : [];
  const at = log.findIndex((entry) => entry && entry.id === session.id);
  const logChanged = at >= 0 && log[at].durationSec !== duration;
  const sessionChanged = session.elapsedSec !== duration;
  if (!logChanged && !sessionChanged) return { progress, session, changed: false };
  return {
    progress: logChanged
      ? stamped({ ...progress, sessionLog: log.map((entry, i) => (i === at ? { ...entry, durationSec: duration } : entry)) }, clock, engineVersion)
      : progress,
    session: { ...session, elapsedSec: duration },
    changed: true,
  };
}

// The summary reached: after the last card, or when the time ran out. The session's log
// entry turns completed, and a daily session counts the day, once, after the streak check.
// A redo never counts. Returns { progress, summary }, the summary holding what the summary
// screen shows:
//   { kind, cards, answered, correct, traps: [cleared, shown], movedUp, streak, countedDay,
//     firstCompleted }
//   streak          { current, longest, freezesRemaining }, or null after a redo
//   countedDay      this session counted today for the streak
//   firstCompleted  no session had been completed on this phone before this one
export function completeSession({ progress, session }, { elapsedSec }, { clock, engineVersion }) {
  const today = learnerDay(clock);
  const duration = Math.round(elapsedSec);
  const firstCompleted = !progress.sessionLog.some((entry) => entry && entry.completed === true);
  const sessionLog = withEntry(progress.sessionLog, session, (entry) => ({
    ...entry,
    durationSec: duration,
    ...shownCounts(session.plan, session.index),
    completed: true,
  }));
  const entry = sessionLog.find((e) => e.id === session.id);
  const streak = session.kind === 'daily' ? countDay(progress.streak, today) : progress.streak;
  const countedDay = session.kind === 'daily' && streak.lastCountedDay === today && progress.streak.lastCountedDay !== today;
  return {
    progress: stamped({ ...progress, sessionLog, streak }, clock, engineVersion),
    summary: {
      kind: session.kind,
      cards: session.index,
      answered: entry.answered,
      correct: entry.correct,
      traps: entry.traps,
      movedUp: session.movedUp,
      streak: session.kind === 'daily' ? { current: streak.current, longest: streak.longest, freezesRemaining: streak.freezesRemaining } : null,
      countedDay,
      firstCompleted,
    },
  };
}
