// Confusions (spec §13.1), recorded as answers are made: which two terms a wrong answer
// mixed up. A pair has no direction, so taking A for B and B for A add to the same count,
// and it is kept with its two term ids in alphabetical order.

const isText = (x) => typeof x === 'string' && x !== '';
const sorted = (a, b) => (a < b ? [a, b] : [b, a]);

const LISTS = { mcq: 'options', desk: 'options', cloze: 'chips' };

// The pairs a wrong answer records, each [first, second] in alphabetical order.
//   score   the result of scoring.scoreAnswer for this card
// On mcq, desk and cloze cards: the chosen option and the correct one, when both name a
// term. On a variant card: the card's own term and each wrongly chosen option that names
// one. Other types record nothing.
export function confusedPairs(card, score) {
  if (!card || !score || score.correct) return [];
  const pairs = [];
  const add = (a, b) => {
    if (!isText(a) || !isText(b) || a === b) return;
    const pair = sorted(a, b);
    if (!pairs.some((p) => p[0] === pair[0] && p[1] === pair[1])) pairs.push(pair);
  };
  const byId = (list) => new Map((Array.isArray(list) ? list : []).map((x) => [String(x.id), x]));
  if (LISTS[card.type]) {
    const items = byId(card[LISTS[card.type]]);
    const chosen = items.get(score.chosen[0]);
    const right = items.get(score.right[0]);
    if (chosen && right) add(chosen.termRef, right.termRef);
  } else if (card.type === 'variant') {
    const items = byId(card.options);
    for (const id of score.chosen) {
      const option = items.get(id);
      if (option && option.correct !== true) add(card.termRef, option.termRef);
    }
  }
  return pairs;
}

// The confusions list with these pairs counted on that day.
export function recordConfusions(confusions, pairs, day) {
  let list = Array.isArray(confusions) ? confusions : [];
  for (const pair of pairs) {
    const same = (c) => Array.isArray(c.pair) && c.pair.length === 2 && sorted(c.pair[0], c.pair[1]).join('\n') === pair.join('\n');
    list = list.some(same)
      ? list.map((c) => (same(c) ? { ...c, pair, count: (c.count || 0) + 1, lastOn: day } : c))
      : [...list, { pair, count: 1, countAtLastContrast: 0, lastOn: day }];
  }
  return list;
}
