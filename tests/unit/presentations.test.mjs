import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawPresentation, repeatsPrevious } from '../../engine/option-order.js';
import { createPresentations, memoryStore } from '../../engine/presentations.js';
import { clockAt } from './clock.mjs';
import { seededRandom } from './seeded.mjs';

// A stand-in for the phone's store, which keeps what it is given as written, the way
// IndexedDB keeps a copy.
function standInStore() {
  const entries = new Map();
  const puts = [];
  return {
    puts,
    get: async (key) => (entries.has(key) ? structuredClone(entries.get(key)) : null),
    put: async (key, value) => {
      puts.push(key);
      entries.set(key, structuredClone(value));
    },
  };
}

test('the last presentation of a card is kept in the store passed in, with when it was shown', async () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  const store = standInStore();
  const memory = createPresentations(store, clock);
  assert.equal(await memory.last('c1'), null);
  const lists = { options: ['b', 'a', 'c'] };
  await memory.record('c1', lists);
  lists.options.push('mutated');
  assert.deepEqual(await memory.last('c1'), { lists: { options: ['b', 'a', 'c'] }, shownAt: clock.now() });
  const got = await memory.last('c1');
  got.lists.options.reverse();
  assert.deepEqual((await memory.last('c1')).lists.options, ['b', 'a', 'c'], 'callers get copies');
  assert.deepEqual(store.puts, ['c1']);
});

test('the order survives a restart: a new reader over the same store draws a different order (test 25)', async () => {
  const card = {
    cardId: 'c2',
    type: 'mcq',
    options: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, text: id, correct: i === 0 })),
  };
  const store = standInStore();
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  for (let seed = 1; seed <= 40; seed++) {
    const before = createPresentations(store, clock);
    const previous = await before.last('c2');
    const shown = drawPresentation(card, previous && previous.lists, seededRandom(seed));
    await before.record('c2', shown);
    const afterRestart = createPresentations(store, clock);
    const remembered = await afterRestart.last('c2');
    const next = drawPresentation(card, remembered.lists, seededRandom(seed + 1000));
    assert.ok(!repeatsPrevious(next.options, shown.options), `seed ${seed}`);
  }
});

test('the memory store works the same way, for tests and before storage opens', async () => {
  const store = memoryStore();
  assert.equal(await store.get('x'), null);
  await store.put('x', { lists: {}, shownAt: 1 });
  assert.deepEqual(await store.get('x'), { lists: {}, shownAt: 1 });
});
