import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isId, newId } from '../../engine/ids.js';
import { seededRandom } from './seeded.mjs';

test('an id is a version 4 UUID in lowercase, made from the random source', () => {
  const random = seededRandom(11);
  const ids = Array.from({ length: 200 }, () => newId(random));
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(isId(id), true);
  }
  assert.equal(new Set(ids).size, ids.length, 'no id comes twice');
  assert.deepEqual(
    Array.from({ length: 3 }, ((r) => () => newId(r))(seededRandom(11))),
    ids.slice(0, 3),
    'the same source gives the same ids',
  );
});

test('anything else is not an id', () => {
  for (const x of ['', 'abc', '3F2B8C1E-6D0A-4C3E-9B8F-2A1D7E5C4B90', '3f2b8c1e-6d0a-1c3e-9b8f-2a1d7e5c4b90', '3f2b8c1e-6d0a-4c3e-7b8f-2a1d7e5c4b90', null, 7]) {
    assert.equal(isId(x), false, String(x));
  }
  assert.equal(isId('3f2b8c1e-6d0a-4c3e-9b8f-2a1d7e5c4b90'), true);
});
