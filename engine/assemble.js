// Assembling a session (spec §5.2). The daily session's plan depends only on the progress,
// the content, the day, when each card was last shown and the random source.
//
// A plan is a list of items in the order they are played:
//   { cardId, part, block, final }
//   part    'new' for the current lesson's cards, 'review' for a due review, 'early' for
//           an early review, 'desk' for a final desk card taken from a completed lesson,
//           'redo' for a card of a lesson being redone
//   block   cards with the same number stay together: a run of teach cards and the test
//           after them. Anything added later goes between blocks, never inside one
//   final   the session's final desk card: nothing is placed after it

import { blocksOf, estimateOf } from './catalogue.js';
import { currentLessonId } from './lessons.js';
import { isTestable } from './scoring.js';
import { MAX_REVIEWS, backlog, cardForAtom, dueList, longestAgo, notYetDue } from './schedule.js';

export const OVERRUN_SECONDS = 120; // a session may run to B + 120 seconds, never past it
export const REVIEW_SHARE = 0.4; // of B, in the 8-, 11- and 14-minute sessions
export const TESTABLE_SHARE = 0.6; // of a session's cards, at least
export const SHORT_SESSION_SECONDS = 300; // the 5-minute session orders itself differently

const seconds = (entries) => entries.reduce((sum, entry) => sum + estimateOf(entry.card), 0);

// The estimated seconds of a plan, from its cards' types.
export function planSeconds(plan, catalogue) {
  return plan.reduce((sum, item) => sum + estimateOf(catalogue.cards.get(item.cardId)?.card), 0);
}

// The daily session for this progress and content on this day.
//   lastShown   Map cardId -> when the card was last shown, from the presentations store
// Returns { plan, lengthSec, estimateSec, catchingUp, dueCount, lessonId }: `catchingUp` is
// the backlog switch after this assembly, and `lessonId` the lesson new material comes
// from, or null when none is left to take.
export function assembleDaily({ progress, catalogue, day, lastShown, random }) {
  const budget = progress.settings.sessionSeconds;
  const position = progress.position;
  const short = budget === SHORT_SESSION_SECONDS;

  // Steps 1 and 2: the current lesson, the due atoms, and the backlog check.
  const due = dueList(progress, catalogue, day);
  const catchingUp = backlog(due.length, position.catchingUp);
  const lessonId = currentLessonId(catalogue.order, position);
  const inOrder = lessonId != null && catalogue.order.lessons.some((entry) => entry.lesson.lessonId === lessonId);
  const lesson = inOrder ? catalogue.lessons.get(lessonId).lesson : null;
  const newLeft = lesson !== null && position.currentCardIndex < lesson.cards.length;
  const blocks = newLeft && !catchingUp ? blocksOf(lesson.cards, position.currentCardIndex) : [];
  const later = notYetDue(progress, catalogue, day);

  // Reviews keep to 40% of the budget in the longer sessions. In the 5-minute session,
  // while catching up, and when no new material is left, they may use all of it.
  const share = short || catchingUp || !newLeft ? budget : REVIEW_SHARE * budget;

  // Desk cards of completed lessons, for a session that doesn't reach its lesson's own.
  const completed = new Set(position.lessonsCompleted);
  const deskPool = [...catalogue.cards.values()].filter((entry) => entry.card.type === 'desk' && completed.has(entry.lessonId) && typeof entry.card.srsKey === 'string');

  // Step 6: the final desk card for a session holding these atoms. The lesson's own when
  // the new material reaches the lesson's end; otherwise one from a completed lesson whose
  // atom isn't in the session, the one presented longest ago; otherwise none.
  const finalDesk = (ownDesk, atoms) => {
    if (ownDesk) return null;
    return longestAgo(deskPool.filter((entry) => !atoms.has(entry.card.srsKey)), lastShown);
  };

  // Steps 3, 4 and 6 for the first `count` blocks of new material.
  const build = (count) => {
    const fresh = blocks.slice(0, count).map((indexes) => indexes.map((index) => ({ card: lesson.cards[index], index })));
    const freshCards = fresh.flat();
    const freshAtoms = new Set(freshCards.filter((entry) => isTestable(entry.card)).map((entry) => entry.card.srsKey));
    const last = freshCards[freshCards.length - 1];
    const ownDesk = count > 0 && count === blocks.length && last.card.type === 'desk';

    // One review per atom: an atom that a card of the new material tests is left to that
    // card, and the next due atom takes its place.
    const reviews = [];
    const atoms = new Set(freshAtoms);
    let desk = finalDesk(ownDesk, atoms);
    for (const item of due) {
      if (reviews.length >= MAX_REVIEWS) break;
      if (freshAtoms.has(item.key)) continue;
      const entry = cardForAtom(item.atom, item.entries, lastShown);
      const withIt = new Set(atoms).add(item.key);
      const deskWithIt = finalDesk(ownDesk, withIt);
      const reviewSeconds = seconds(reviews) + estimateOf(entry.card);
      // At least one review whenever one is due; after that, within the share, and where
      // reviews have the whole budget, within it together with the final desk card.
      if (reviews.length > 0) {
        if (reviewSeconds > share) break;
        if (share === budget && reviewSeconds + (deskWithIt ? estimateOf(deskWithIt.card) : 0) > budget) break;
      }
      reviews.push({ key: item.key, card: entry.card });
      atoms.add(item.key);
      desk = deskWithIt;
    }
    return { fresh, freshCards, ownDesk, reviews, early: [], desk, atoms };
  };

  const total = (s) => seconds(s.freshCards) + seconds(s.reviews) + seconds(s.early) + (s.desk ? estimateOf(s.desk.card) : 0);

  // Step 4: new material a block at a time, while everything together fits the budget.
  let count = 0;
  while (count < blocks.length && total(build(count + 1)) <= budget) count++;

  // Step 5, the ratio guard: testable cards are at least 60% of the session. Early reviews
  // are added until it holds; if the next one would take the plan past B + 120 seconds,
  // the last block of new material is dropped and everything is worked out again.
  let session;
  for (;;) {
    session = build(count);
    const nextEarly = () => later.find((item) => !session.atoms.has(item.key) && !(session.desk && session.desk.card.srsKey === item.key));
    const cardCount = () => session.freshCards.length + session.reviews.length + session.early.length + (session.desk ? 1 : 0);
    const testable = () => cardCount() - session.freshCards.filter((entry) => !isTestable(entry.card)).length;
    let dropped = false;
    while (testable() < TESTABLE_SHARE * cardCount()) {
      const item = nextEarly();
      if (!item) break; // no atom is left to add: the session keeps what it has
      const entry = cardForAtom(item.atom, item.entries, lastShown);
      if (total(session) + estimateOf(entry.card) > budget + OVERRUN_SECONDS) {
        dropped = count > 0;
        break;
      }
      session.early.push({ key: item.key, card: entry.card });
      session.atoms.add(item.key);
    }
    if (!dropped) break;
    count--;
  }

  // With nothing due and nothing new in the session, it is early reviews, so the streak
  // can still be kept: as many as fit the budget, at most 20, the soonest due first.
  if (session.freshCards.length === 0 && session.reviews.length === 0) {
    for (const item of later) {
      if (session.early.length >= MAX_REVIEWS) break;
      const entry = cardForAtom(item.atom, item.entries, lastShown);
      const withIt = new Set(session.atoms).add(item.key);
      const desk = finalDesk(false, withIt);
      if (seconds(session.early) + estimateOf(entry.card) + (desk ? estimateOf(desk.card) : 0) > budget) break;
      session.early.push({ key: item.key, card: entry.card });
      session.atoms = withIt;
      session.desk = desk;
    }
  }

  // Step 7: the order. Each review goes to a random block boundary within the new
  // material, never inside a block and never after the final desk card. In the 5-minute
  // session the reviews come first, then the new material, then the final desk card.
  const extras = [
    ...session.reviews.map((r) => ({ cardId: r.card.cardId, part: 'review' })),
    ...session.early.map((r) => ({ cardId: r.card.cardId, part: 'early' })),
  ];
  const slots = Array.from({ length: session.fresh.length + 1 }, () => []);
  const lastSlot = session.ownDesk ? session.fresh.length - 1 : session.fresh.length;
  for (const extra of extras) {
    const slot = short || session.fresh.length === 0 ? 0 : random.below(lastSlot + 1);
    slots[slot].push(extra);
  }
  const plan = [];
  let block = 0;
  const addExtras = (list) => {
    for (const extra of list) plan.push({ ...extra, block: block++, final: false });
  };
  session.fresh.forEach((cards, i) => {
    addExtras(slots[i]);
    for (const entry of cards) plan.push({ cardId: entry.card.cardId, part: 'new', block, final: false });
    block++;
  });
  addExtras(slots[session.fresh.length]);
  if (session.ownDesk) plan[plan.length - 1].final = true;
  else if (session.desk) plan.push({ cardId: session.desk.card.cardId, part: 'desk', block: block++, final: true });

  return {
    plan,
    lengthSec: budget,
    estimateSec: planSeconds(plan, catalogue),
    catchingUp,
    dueCount: due.length,
    lessonId: newLeft ? lessonId : null,
  };
}

// A redo: every card of a completed lesson, in order. Its last card, when it is a desk
// card, is the final one, so re-asks stay before it.
export function assembleRedo(lesson) {
  const plan = [];
  blocksOf(lesson.cards).forEach((indexes, block) => {
    for (const index of indexes) plan.push({ cardId: lesson.cards[index].cardId, part: 'redo', block, final: false });
  });
  const last = lesson.cards[lesson.cards.length - 1];
  if (plan.length > 0 && last.type === 'desk') plan[plan.length - 1].final = true;
  return plan;
}
