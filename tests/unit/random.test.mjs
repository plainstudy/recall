import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRandom, shuffle } from '../../engine/random.js';
import { seededRandom, seededUint32 } from './seeded.mjs';

const fromList = (values) => {
  let i = 0;
  return () => values[i++];
};

test('below() rejects draws past the last whole multiple, so no remainder is favoured', () => {
  // 2^32 leaves a remainder of 1 when divided by 3, so the top value must be thrown away.
  const random = createRandom(fromList([0xffffffff, 5]));
  assert.equal(random.below(3), 2);
});

test('below() accepts the largest value that completes a whole multiple', () => {
  const random = createRandom(fromList([0xfffffffe]));
  assert.equal(random.below(3), 0xfffffffe % 3);
});

test('below() stays in range and refuses a range it cannot serve', () => {
  const random = seededRandom(1);
  for (let i = 0; i < 1000; i++) {
    const n = 1 + (i % 7);
    const x = random.below(n);
    assert.ok(Number.isInteger(x) && x >= 0 && x < n);
  }
  assert.throws(() => random.below(0), RangeError);
  assert.throws(() => random.below(1.5), RangeError);
});

test('the seeded source repeats exactly for the same seed', () => {
  const a = seededUint32(7);
  const b = seededUint32(7);
  const c = seededUint32(8);
  const first = Array.from({ length: 5 }, a);
  assert.deepEqual(first, Array.from({ length: 5 }, b));
  assert.notDeepEqual(first, Array.from({ length: 5 }, c));
});

test('shuffle() returns a permutation and leaves the input alone', () => {
  const input = ['a', 'b', 'c', 'd', 'e'];
  const out = shuffle(input, seededRandom(3));
  assert.deepEqual([...out].sort(), input);
  assert.deepEqual(input, ['a', 'b', 'c', 'd', 'e']);
});
