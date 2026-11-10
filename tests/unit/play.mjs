// Playing a session in unit tests, card by card, through the engine alone: what the page
// does on the phone, without the page.
import { scoreAnswer } from '../../engine/scoring.js';
import { applyAnswer, applyTeach, completeSession, nextStep } from '../../engine/session.js';
import { ENGINE } from './phone.mjs';

// An answer to the card, right or wrong, in the shape its type takes.
export function answerFor(card, right) {
  switch (card.type) {
    case 'mcq':
    case 'desk':
      return { choice: card.options.find((o) => (o.correct === true) === right).id };
    case 'cloze':
      return { choice: card.chips.find((c) => (c.correct === true) === right).id };
    case 'hotspot':
      return { choice: card.regions.find((r) => (r.correct === true) === right).id };
    case 'multi':
    case 'variant':
      return { choices: right ? card.options.filter((o) => o.correct).map((o) => o.id) : [card.options.find((o) => !o.correct).id] };
    case 'match': {
      const ids = card.pairs.map((p) => p.id);
      return { pairs: ids.map((id, i) => [id, right ? id : ids[(i + 1) % ids.length]]) };
    }
    case 'order': {
      const sorted = [...card.items].sort((a, b) => a.position - b.position).map((item) => item.id);
      return { sequence: right ? sorted : sorted.reverse() };
    }
    default:
      throw new Error(`no answer for ${card.type}`);
  }
}

// Plays one card of the session: a teach card is passed, any other answered right unless
// `wrong(card, item)` says otherwise. `seconds` is the time on screen once it is done.
// Returns the state after it, with `step` describing what happened.
export function playCard(state, ctx, { wrong = () => false, seconds = state.session.elapsedSec } = {}) {
  const step = nextStep(state.session, ctx.catalogue, state.session.elapsedSec);
  if (step.done) return { ...state, step };
  const { card } = step.where;
  if (card.type === 'teach') {
    const after = applyTeach(state, { elapsedSec: seconds }, ctx);
    return { progress: after.progress, session: after.session, step: { ...step, changed: after.changed } };
  }
  const answer = answerFor(card, !wrong(card, step.item));
  const score = scoreAnswer(card, answer);
  const after = applyAnswer(state, { score, answer, lists: {}, elapsedSec: seconds }, ctx);
  return { progress: after.progress, session: after.session, step: { ...step, correct: score.correct, reAsked: after.reAsked, movedUp: after.movedUp } };
}

// Plays the session from where it stands to its end, each card taking `perCard` seconds on
// screen, then completes it. Returns { progress, session, summary, shown, reason }: `shown`
// lists the plan items played, and `reason` is 'end' or 'time'.
export function playToEnd(state, ctx, { wrong = () => false, perCard = 0, complete = true } = {}) {
  let current = { progress: state.progress, session: state.session };
  const shown = [];
  for (;;) {
    const elapsed = current.session.elapsedSec;
    const next = playCard(current, ctx, { wrong, seconds: elapsed + perCard });
    if (next.step.done) {
      if (!complete) return { ...current, shown, reason: next.step.reason };
      const done = completeSession(current, { elapsedSec: elapsed }, ctx);
      return { progress: done.progress, session: current.session, summary: done.summary, shown, reason: next.step.reason };
    }
    shown.push({ ...next.step.item, correct: next.step.correct, reAsked: next.step.reAsked });
    current = { progress: next.progress, session: next.session };
  }
}

export const ctxOf = (phone, clock, random) => ({ catalogue: phone.catalogue, clock, engineVersion: ENGINE, random });
