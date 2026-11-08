// Option order for each presentation of a card.
//
//   1. Every presentation draws a new order for each of the card's lists.
//   2. A list of three or more never repeats the order it had at the card's previous
//      presentation. A list of two is free, since strict alternation is a pattern too.
//   3. An order card's items never start in their correct sequence.
//   4. A match card never shows every pair on the same row.
//   5. Hotspot regions stay where the figure puts them: the card has no lists.
//   6. Among the orders these rules allow, every one is equally likely: the whole draw is
//      a Fisher-Yates shuffle, repeated while any rule fails, and never adjusted by hand.
//
// Lists hold ids, never positions, and scoring follows the ids.

import { shuffle } from './random.js';
import { orderIsCorrect } from './scoring.js';

const MAX_DRAWS = 1000;

const ids = (list) => (Array.isArray(list) ? list.map((x) => String(x.id)) : []);

// The lists a card reorders, by name, each in file order.
export function listsOf(card) {
  switch (card && card.type) {
    case 'mcq':
    case 'desk':
    case 'multi':
    case 'variant':
      return { options: ids(card.options) };
    case 'cloze':
      return { chips: ids(card.chips) };
    case 'match':
      return { left: ids(card.pairs), right: ids(card.pairs) };
    case 'order':
      return { items: ids(card.items) };
    default:
      return {};
  }
}

const sameIds = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

const sameOrder = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

// Rule 2. A remembered order that holds different ids, from another file with the same
// card id, says nothing about this list and is ignored.
export function repeatsPrevious(order, previous) {
  return order.length >= 3 && sameIds(order, previous) && sameOrder(order, previous);
}

function breaksTypeRule(card, draw) {
  if (card.type === 'order' && draw.items.length >= 2) return orderIsCorrect(card.items, draw.items);
  if (card.type === 'match' && draw.left.length >= 2) return sameOrder(draw.left, draw.right);
  return false;
}

// The new order of every list on the card, as { listName: [id, ...] }. previous is the
// card's lists at its last presentation, or null.
export function drawPresentation(card, previous, random) {
  const lists = listsOf(card);
  const names = Object.keys(lists);
  if (names.length === 0) return {};
  const before = previous || {};
  let draw = null;
  for (let i = 0; i < MAX_DRAWS; i++) {
    draw = {};
    for (const name of names) draw[name] = shuffle(lists[name], random);
    const fails = names.some((name) => repeatsPrevious(draw[name], before[name])) || breaksTypeRule(card, draw);
    if (!fails) return draw;
  }
  // Only a malformed card can get here; showing it beats refusing to.
  return draw;
}
