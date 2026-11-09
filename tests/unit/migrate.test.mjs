import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isId } from '../../engine/ids.js';
import { upgradeProgress } from '../../engine/migrate.js';
import { PROGRESS_MESSAGES, checkProgress, newProgress } from '../../engine/progress.js';
import { clockAt } from './clock.mjs';
import { asSchemaTwo, seasonedProgress } from './fixtures.mjs';
import { seededRandom } from './seeded.mjs';

const clock = () => clockAt('2026-11-15T07:14:00+03:00');
const current = () => seasonedProgress(newProgress({ name: 'Sam', role: 'Baker' }, clock(), '0.3.0', seededRandom(1)));

test('schema 2 progress migrates with nothing lost, and gains its ids and change times (test 38)', () => {
  const older = asSchemaTwo(current());
  assert.equal(checkProgress(older).ok, false, 'unmigrated, it does not fit the current schema');
  const before = structuredClone(older);

  const read = upgradeProgress(older, seededRandom(5));
  assert.equal(read.ok, true, read.message);
  assert.equal(read.migrated, true);
  const p = read.progress;
  assert.deepEqual(older, before, 'the older copy itself is left as it was');
  assert.deepEqual(checkProgress(p), { ok: true });
  assert.equal(p.schemaVersion, 3);

  // The new fields.
  assert.equal(isId(p.deviceId), true);
  assert.equal(isId(p.profile.learnerId), true);
  assert.notEqual(p.deviceId, p.profile.learnerId);
  const sessionIds = p.sessionLog.map((s) => s.id);
  assert.ok(sessionIds.every(isId));
  assert.equal(new Set(sessionIds).size, sessionIds.length);
  for (const atom of Object.values(p.atoms)) assert.equal(atom.changedAt, null, 'filled by the atom’s next change');

  // Everything else exactly as it was.
  assert.deepEqual(asSchemaTwo(p), older);
  assert.deepEqual(Object.keys(p).slice(0, 5), ['schemaVersion', 'savedOn', 'engineVersion', 'deviceId', 'profile']);
});

test('progress already at the current schema is checked and passed through unchanged', () => {
  const now = current();
  const read = upgradeProgress(now, seededRandom(5));
  assert.equal(read.ok, true);
  assert.equal(read.migrated, false);
  assert.equal(read.progress, now);
});

test('only a newer schema is refused for its version; what no app ever wrote does not fit', () => {
  const now = current();
  assert.deepEqual(upgradeProgress({ ...now, schemaVersion: 4 }, seededRandom(5)), {
    ok: false,
    message: PROGRESS_MESSAGES.newerApp,
    field: 'schemaVersion',
  });
  for (const odd of [{ ...asSchemaTwo(now), schemaVersion: 1 }, { ...now, schemaVersion: '3' }, null, [], 'progress']) {
    const read = upgradeProgress(odd, seededRandom(5));
    assert.deepEqual([read.ok, read.message], [false, PROGRESS_MESSAGES.mismatch]);
  }
});

test('older progress that is broken is refused after migration, without throwing', () => {
  const older = asSchemaTwo(current());
  for (const [field, broken] of [
    ['profile', { ...older, profile: null }],
    ['atoms', { ...older, atoms: [] }],
    ['sessionLog', { ...older, sessionLog: 'none' }],
    ['streak', { ...older, streak: { ...older.streak, freezesRemaining: 3 } }],
  ]) {
    const read = upgradeProgress(broken, seededRandom(5));
    assert.deepEqual([read.ok, read.message, read.field], [false, PROGRESS_MESSAGES.mismatch, field], field);
  }
});
