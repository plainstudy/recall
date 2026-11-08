import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawPresentation, listsOf, repeatsPrevious } from '../../engine/option-order.js';
import { createPresentationMemory } from '../../engine/presentations.js';
import { orderIsCorrect } from '../../engine/scoring.js';
import { seededRandom } from './seeded.mjs';

const ids = (n) => Array.from({ length: n }, (_, i) => `o${i + 1}`);
const options = (n) => ids(n).map((id, i) => ({ id, text: `Option ${id}`, correct: i === 0 }));
const choiceCard = (type, n) => ({ cardId: `${type}${n}`, type, options: options(n) });
const clozeCard = (n) => ({ cardId: `cloze${n}`, type: 'cloze', chips: options(n) });
const matchCard = (n) => ({
  cardId: `match${n}`,
  type: 'match',
  pairs: ids(n).map((id) => ({ id, left: `L ${id}`, right: `R ${id}` })),
});
const orderCard = (n) => ({
  cardId: `order${n}`,
  type: 'order',
  items: ids(n).map((id, i) => ({ id, text: `Step ${id}`, position: i + 1 })),
});

// Presents the card again and again, each time against the previous presentation, as the
// app does, and returns every draw.
function presentRepeatedly(card, times, seed) {
  const random = seededRandom(seed);
  const draws = [];
  let previous = null;
  for (let i = 0; i < times; i++) {
    const draw = drawPresentation(card, previous, random);
    draws.push(draw);
    previous = draw;
  }
  return draws;
}

const key = (order) => order.join(',');

test('each card type names the lists it reorders, and a hotspot has none', () => {
  assert.deepEqual(Object.keys(listsOf(choiceCard('mcq', 3))), ['options']);
  assert.deepEqual(Object.keys(listsOf(choiceCard('desk', 3))), ['options']);
  assert.deepEqual(Object.keys(listsOf(choiceCard('multi', 4))), ['options']);
  assert.deepEqual(Object.keys(listsOf(choiceCard('variant', 4))), ['options']);
  assert.deepEqual(Object.keys(listsOf(clozeCard(3))), ['chips']);
  assert.deepEqual(Object.keys(listsOf(matchCard(3))), ['left', 'right']);
  assert.deepEqual(Object.keys(listsOf(orderCard(3))), ['items']);
  assert.deepEqual(listsOf({ type: 'hotspot', regions: [{ id: 'a' }, { id: 'b' }] }), {});
  assert.deepEqual(listsOf({ type: 'teach' }), {});
  const hotspot = { type: 'hotspot', regions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.deepEqual(drawPresentation(hotspot, null, seededRandom(1)), {});
});

test('a list of three or more never repeats its previous order, on every card type', () => {
  const cards = [];
  for (let n = 3; n <= 6; n++) {
    if (n <= 4) cards.push(choiceCard('mcq', n), choiceCard('desk', n), clozeCard(n));
    cards.push(choiceCard('multi', n), choiceCard('variant', n), orderCard(n));
    if (n <= 5) cards.push(matchCard(n));
  }
  for (const card of cards) {
    const draws = presentRepeatedly(card, 2000, card.cardId.length * 31 + 7);
    for (let i = 1; i < draws.length; i++) {
      for (const name of Object.keys(draws[i])) {
        assert.notEqual(key(draws[i][name]), key(draws[i - 1][name]), `${card.cardId} ${name} repeated`);
      }
    }
  }
});

test('a list of two may repeat, so it never strictly alternates', () => {
  const card = { cardId: 'two', type: 'mcq', options: options(2) };
  const draws = presentRepeatedly(card, 200, 11);
  const repeats = draws.slice(1).filter((d, i) => key(d.options) === key(draws[i].options)).length;
  assert.ok(repeats > 0, 'a two-item list repeated at least once');
});

test('an order card never starts in its correct sequence', () => {
  for (let n = 3; n <= 6; n++) {
    const card = orderCard(n);
    for (const draw of presentRepeatedly(card, 2000, n)) {
      assert.equal(orderIsCorrect(card.items, draw.items), false);
    }
  }
});

test('a match card never puts every pair on the same row', () => {
  for (let n = 3; n <= 5; n++) {
    const card = matchCard(n);
    for (const draw of presentRepeatedly(card, 2000, 100 + n)) {
      assert.notEqual(key(draw.left), key(draw.right));
    }
  }
});

test('every allowed order of a three-item list turns up, about equally often', () => {
  const card = choiceCard('mcq', 3);
  const previous = { options: ['o1', 'o2', 'o3'] };
  const random = seededRandom(2026);
  const counts = new Map();
  const draws = 6000;
  for (let i = 0; i < draws; i++) {
    const order = key(drawPresentation(card, previous, random).options);
    counts.set(order, (counts.get(order) || 0) + 1);
  }
  assert.equal(counts.has('o1,o2,o3'), false, 'the previous order never comes back');
  assert.equal(counts.size, 5, 'the five other orders all turn up');
  for (const [order, count] of counts) {
    const share = count / (draws / 5);
    assert.ok(share > 0.85 && share < 1.15, `${order} turned up ${count} times`);
  }
});

test('every allowed starting order of a three-item order card turns up', () => {
  const card = orderCard(3);
  const previous = { items: ['o2', 'o1', 'o3'] };
  const random = seededRandom(5);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(key(drawPresentation(card, previous, random).items));
  assert.deepEqual([...seen].sort(), ['o1,o3,o2', 'o2,o3,o1', 'o3,o1,o2', 'o3,o2,o1']);
});

test('a remembered order with different ids is ignored', () => {
  assert.equal(repeatsPrevious(['a', 'b', 'c'], ['a', 'b', 'c']), true);
  assert.equal(repeatsPrevious(['a', 'b', 'c'], ['a', 'b', 'x']), false);
  assert.equal(repeatsPrevious(['a', 'b', 'c'], ['a', 'b']), false);
  assert.equal(repeatsPrevious(['a', 'b', 'c'], undefined), false);
  assert.equal(repeatsPrevious(['a', 'b'], ['a', 'b']), false);
});

test('the presentation memory keeps each card’s last lists and when they were shown', async () => {
  let now = 1000;
  const memory = createPresentationMemory({ now: () => now });
  assert.equal(await memory.last('c1'), null);
  const lists = { options: ['b', 'a', 'c'] };
  await memory.record('c1', lists);
  lists.options.reverse();
  now = 2000;
  await memory.record('c2', { left: ['x', 'y'], right: ['y', 'x'] });
  assert.deepEqual(await memory.last('c1'), { lists: { options: ['b', 'a', 'c'] }, shownAt: 1000 });
  assert.deepEqual(await memory.last('c2'), { lists: { left: ['x', 'y'], right: ['y', 'x'] }, shownAt: 2000 });
});
