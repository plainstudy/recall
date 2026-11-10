import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROGRESS_MESSAGES,
  checkName,
  checkProgress,
  emptyInstalled,
  installedFrom,
  newProgress,
  newerOf,
  restoredProgress,
} from '../../engine/progress.js';
import { clockAt } from './clock.mjs';
import { fixture, seasonedProgress } from './fixtures.mjs';
import { seededRandom } from './seeded.mjs';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("first run creates the progress object with spec §3.7's starting values", () => {
  const clock = clockAt('2026-11-16T02:30:00+03:00');
  const made = newProgress({ name: 'Sam', role: 'Baker' }, clock, '0.3.0', seededRandom(1));
  assert.match(made.deviceId, ID);
  assert.match(made.profile.learnerId, ID);
  assert.notEqual(made.deviceId, made.profile.learnerId);
  assert.deepEqual(made, {
    schemaVersion: 3,
    savedOn: '2026-11-16T02:30:00+03:00',
    engineVersion: '0.3.0',
    deviceId: made.deviceId,
    profile: { learnerId: made.profile.learnerId, name: 'Sam', role: 'Baker', createdOn: '2026-11-15' },
    installed: {
      bundleId: null,
      bundleVersion: null,
      title: null,
      reportPrefix: null,
      trackId: null,
      trackVersion: null,
      trackTitle: null,
      glossaryVersion: null,
      packs: {},
    },
    settings: { sessionSeconds: 660, theme: 'phone' },
    streak: {
      current: 0,
      longest: 0,
      lastCountedDay: null,
      checkedThrough: null,
      freezesRemaining: 2,
      freezesUsedOn: [],
      countedRun: 0,
      dayBoundaryHour: 4,
    },
    position: { currentLesson: null, currentCardIndex: 0, lessonsCompleted: [], catchingUp: false },
    atoms: {},
    families: {},
    confusions: [],
    termRequests: [],
    sessionLog: [],
    reportsSavedOn: [],
  });
});

test('the name is required, trimmed, and at most 40 characters', () => {
  assert.deepEqual(checkName('  Sam  '), { ok: true, name: 'Sam', problem: null });
  assert.equal(checkName('   ').problem, PROGRESS_MESSAGES.nameMissing);
  assert.equal(checkName('x'.repeat(40)).ok, true);
  assert.equal(checkName('x'.repeat(41)).problem, PROGRESS_MESSAGES.tooLong);
  assert.equal(checkName('Ю'.repeat(40)).ok, true, 'characters, not bytes');
});

test('of two copies the later-saved one wins, and the first on a tie', () => {
  const a = { savedOn: '2026-11-15T07:14:00+03:00', id: 'a' };
  const b = { savedOn: '2026-11-15T05:00:00+00:00', id: 'b' };
  assert.equal(newerOf(a, b).id, 'b', '05:00 UTC is after 04:14 UTC');
  assert.equal(newerOf(b, a).id, 'b');
  assert.equal(newerOf(a, { ...a, id: 'c' }).id, 'a');
  assert.equal(newerOf(null, b).id, 'b');
  assert.equal(newerOf(a, null).id, 'a');
  assert.equal(newerOf(a, { savedOn: 'garbled' }).id, 'a');
  assert.equal(newerOf(null, null), null);
});

test('installed describes the content on the phone', () => {
  const bundle = fixture('bundle-bakery.json');
  const { glossary, packs, track, ...details } = bundle;
  assert.deepEqual(installedFrom({ bundle: details, glossary, track, packs: { bakery_basics: packs[0] } }), {
    bundleId: 'bakery',
    bundleVersion: '1.0',
    title: 'Bakery School',
    reportPrefix: 'Bakery_School',
    trackId: 'baker',
    trackVersion: '1.0',
    trackTitle: 'Baker',
    glossaryVersion: '1.1',
    packs: { bakery_basics: '1.0' },
  });
  assert.deepEqual(installedFrom({ bundle: null, glossary: null, track: null, packs: {} }), emptyInstalled());
});

test("a report's progress is checked against the progress object, and a newer app's is refused", () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  const good = seasonedProgress(newProgress({ name: 'Sam', role: 'Baker' }, clock, '0.3.0', seededRandom(1)));
  assert.deepEqual(checkProgress(good), { ok: true });
  assert.deepEqual(checkProgress({ ...good, schemaVersion: 4 }), { ok: false, message: PROGRESS_MESSAGES.newerApp, field: 'schemaVersion' });
  assert.equal(PROGRESS_MESSAGES.newerApp, 'This report comes from a newer version of the app. Restart the app when it has updated.');
  const broken = [
    ['schemaVersion', { ...good, schemaVersion: 2 }],
    ['schemaVersion', { ...good, schemaVersion: '3' }],
    ['deviceId', { ...good, deviceId: 'this-phone' }],
    ['profile', { ...good, profile: { ...good.profile, learnerId: good.profile.learnerId.toUpperCase() } }],
    ['savedOn', { ...good, savedOn: '2026-11-15' }],
    ['profile', { ...good, profile: { name: 'Sam' } }],
    ['settings', { ...good, settings: { sessionSeconds: 600, theme: 'phone' } }],
    ['settings', { ...good, settings: { sessionSeconds: 660, theme: 'dark' } }],
    ['streak', { ...good, streak: { ...good.streak, freezesRemaining: 3 } }],
    ['position', { ...good, position: { ...good.position, currentCardIndex: -1 } }],
    ['atoms', { ...good, atoms: { 'atom.x.y': { box: 6, dueOn: '2026-11-20', changedAt: null } } }],
    ['atoms', { ...good, atoms: { 'atom.x.y': { box: 2, dueOn: 'tomorrow', changedAt: null } } }],
    ['atoms', { ...good, atoms: { 'atom.x.y': { box: 2, dueOn: '2026-11-20' } } }],
    ['atoms', { ...good, atoms: { 'atom.x.y': { box: 2, dueOn: '2026-11-20', changedAt: '2026-11-15' } } }],
    ['sessionLog', { ...good, sessionLog: [{ day: '2026-11-13', kind: 'daily' }] }],
    ['termRequests', { ...good, termRequests: [{ text: 'x' }] }],
    ['reportsSavedOn', { ...good, reportsSavedOn: ['last week'] }],
  ];
  for (const [field, progress] of broken) {
    assert.deepEqual(checkProgress(progress), { ok: false, message: PROGRESS_MESSAGES.mismatch, field }, field);
  }
  assert.equal(checkProgress([]).ok, false);
});

test("a restore takes the report's progress and its learner id, and keeps this phone's own id and installed (test 38)", () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  const report = seasonedProgress(newProgress({ name: 'Sam', role: 'Baker' }, clock, '0.3.0', seededRandom(1)));
  report.installed = { ...emptyInstalled(), bundleId: 'elsewhere', packs: { other: '3.0' } };
  clock.set('2026-11-15T09:00:00+03:00');
  const phone = newProgress({ name: 'Test', role: 'Test' }, clock, '0.3.0', seededRandom(2));
  assert.notEqual(phone.deviceId, report.deviceId);
  assert.notEqual(phone.profile.learnerId, report.profile.learnerId);
  phone.installed = { ...emptyInstalled(), bundleId: 'bakery', packs: { bakery_basics: '1.0' } };
  const restored = restoredProgress(phone, report, clock, '0.3.0');
  assert.deepEqual(restored, { ...report, deviceId: phone.deviceId, installed: phone.installed, savedOn: '2026-11-15T09:00:00+03:00' });
  assert.equal(restored.profile.learnerId, report.profile.learnerId);

  // Restored some days later, the streak is checked against that day: the report's last
  // counted day was the 14th, so the 15th uses the one freeze left and the 16th resets it.
  clock.set('2026-11-17T09:00:00+03:00');
  const later = restoredProgress(phone, report, clock, '0.3.0');
  assert.deepEqual(later.streak, {
    ...report.streak,
    current: 0,
    freezesRemaining: 0,
    freezesUsedOn: ['2026-11-03', '2026-11-15'],
    countedRun: 0,
    checkedThrough: '2026-11-16',
  });
  assert.deepEqual({ ...later, streak: null, savedOn: null }, { ...restored, streak: null, savedOn: null }, 'nothing else differs');
});
