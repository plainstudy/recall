// Scoring, verdicts and explanations for every card type. Answers name ids, never
// screen positions, so an answer scores the same whatever order the lists were shown in.
//
// Answer shapes:
//   mcq, desk, cloze, hotspot   { choice: id }
//   multi, variant              { choices: [id, ...] }
//   match                       { pairs: [[leftPairId, rightPairId], ...] }
//   order                       { sequence: [itemId, ...] }   first slot first

export const TESTABLE_TYPES = ['mcq', 'multi', 'match', 'order', 'hotspot', 'cloze', 'variant', 'desk'];

const SINGLE = { mcq: 'options', desk: 'options', cloze: 'chips', hotspot: 'regions' };
const MULTIPLE = { multi: 'options', variant: 'options' };

const idOf = (x) => String(x.id);
const listOf = (card, name) => (Array.isArray(card[name]) ? card[name] : []);
const correctIds = (list) => list.filter((x) => x && x.correct === true).map(idOf);

export function isTestable(card) {
  return Boolean(card) && TESTABLE_TYPES.includes(card.type);
}

// True when the sequence puts every item in its own slot: the item in slot k (from 1)
// has position k.
export function orderIsCorrect(items, sequence) {
  if (!Array.isArray(items) || !Array.isArray(sequence) || sequence.length !== items.length) return false;
  const byId = new Map(items.map((item) => [idOf(item), item]));
  if (new Set(sequence.map(String)).size !== sequence.length) return false;
  return sequence.every((id, k) => byId.has(String(id)) && Number(byId.get(String(id)).position) === k + 1);
}

// The result of an answer: { correct, ... } with what each type needs for marking.
// A teach card has no answer and scores null.
export function scoreAnswer(card, answer) {
  if (!isTestable(card) || !answer) return null;

  if (SINGLE[card.type]) {
    const right = correctIds(listOf(card, SINGLE[card.type]));
    const chosen = answer.choice == null ? null : String(answer.choice);
    return { correct: chosen !== null && right.includes(chosen), chosen: chosen === null ? [] : [chosen], right };
  }

  if (MULTIPLE[card.type]) {
    const right = correctIds(listOf(card, MULTIPLE[card.type]));
    const chosen = [...new Set((answer.choices || []).map(String))];
    const correct = chosen.length === right.length && chosen.every((id) => right.includes(id));
    return { correct, chosen, right };
  }

  if (card.type === 'match') {
    const ids = listOf(card, 'pairs').map(idOf);
    const pairs = (answer.pairs || []).map(([left, right]) => ({
      left: String(left),
      right: String(right),
      ok: String(left) === String(right),
    }));
    const lefts = new Set(pairs.map((p) => p.left));
    const rights = new Set(pairs.map((p) => p.right));
    const complete =
      pairs.length === ids.length &&
      lefts.size === ids.length &&
      rights.size === ids.length &&
      ids.every((id) => lefts.has(id) && rights.has(id));
    return { correct: complete && pairs.every((p) => p.ok), pairs };
  }

  // order
  const items = listOf(card, 'items');
  const sequence = (answer.sequence || []).map(String);
  const byId = new Map(items.map((item) => [idOf(item), item]));
  const expected = items
    .slice()
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map(idOf);
  return {
    correct: orderIsCorrect(items, sequence),
    sequence: sequence.map((id, k) => ({ id, ok: byId.has(id) && Number(byId.get(id).position) === k + 1 })),
    expected,
  };
}

// The verdict line: "Correct." or "Incorrect."; on a trap card, "Trap cleared." or "Trap.".
export function verdictFor(card, correct) {
  if (card && card.trap === true) return correct ? 'Trap cleared.' : 'Trap.';
  return correct ? 'Correct.' : 'Incorrect.';
}

const hasText = (s) => typeof s === 'string' && s.trim() !== '';

// The explanation, as a list of paragraphs. On mcq, desk and hotspot cards it starts with
// the chosen option's feedback; after a wrong answer to a trap card, the card's
// trapFeedback takes that place, on every type. The card's own feedback follows.
export function explanationFor(card, answer, correct) {
  const parts = [];
  if (card.trap === true && !correct && hasText(card.trapFeedback)) {
    parts.push(card.trapFeedback);
  } else if (['mcq', 'desk', 'hotspot'].includes(card.type) && answer && answer.choice != null) {
    const chosen = listOf(card, SINGLE[card.type]).find((x) => idOf(x) === String(answer.choice));
    if (chosen && hasText(chosen.feedback)) parts.push(chosen.feedback);
  }
  if (hasText(card.feedback)) parts.push(card.feedback);
  return parts;
}

// Counts for the end of a lesson. results holds one { trap, correct } per answered card.
export function tally(cardCount, results) {
  const traps = results.filter((r) => r.trap);
  return {
    cards: cardCount,
    answered: results.length,
    correct: results.filter((r) => r.correct).length,
    trapsShown: traps.length,
    trapsCleared: traps.filter((r) => r.correct).length,
  };
}

// The one line of counts: "15 cards, 9 answered, 7 correct, 1 of 2 traps cleared."
export function summaryLine(t) {
  const cards = `${t.cards} ${t.cards === 1 ? 'card' : 'cards'}`;
  const traps =
    t.trapsShown === 0
      ? 'no traps'
      : `${t.trapsCleared} of ${t.trapsShown} ${t.trapsShown === 1 ? 'trap' : 'traps'} cleared`;
  return `${cards}, ${t.answered} answered, ${t.correct} correct, ${traps}.`;
}
