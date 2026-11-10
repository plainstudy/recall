// The role comes from the installed track (spec §3.7, §3.8; acceptance test 41).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyContent, planImport, planRemove, progressAfter } from '../../engine/importing.js';
import { checkName, newProgress, PROGRESS_MESSAGES, PROFILE_MAX, roleOf } from '../../engine/progress.js';
import { buildReport } from '../../engine/report.js';
import { APP_NAME } from '../../ui/app-name.js';
import { clockAt } from './clock.mjs';
import { fixtureText } from './fixtures.mjs';
import { ENGINE, installOn } from './phone.mjs';
import { seededRandom } from './seeded.mjs';

const clock = () => clockAt('2026-11-15T07:14:00+03:00');
const newPhone = (c) => ({ content: emptyContent(), progress: newProgress({ name: 'Sam' }, c, ENGINE, seededRandom(1)) });
const asObject = (fixture) => JSON.parse(fixtureText(fixture));
const track = (changes) => ({ kind: 'track', data: { ...asObject('track-bakery.json'), ...changes } });

test('first run asks only the name: trimmed, required, at most 40 characters', () => {
  assert.deepEqual(checkName('  Sam  '), { ok: true, name: 'Sam', problem: null });
  assert.equal(checkName('   ').problem, PROGRESS_MESSAGES.nameMissing);
  assert.equal(checkName('x'.repeat(PROFILE_MAX)).ok, true);
  assert.equal(checkName('x'.repeat(PROFILE_MAX + 1)).problem, PROGRESS_MESSAGES.tooLong);
});

test('a new learner has no role until a track is installed', () => {
  const c = clock();
  const phone = newPhone(c);
  assert.equal(phone.progress.profile.role, '');
  // Content without a track leaves it empty.
  const withGlossary = installOn(phone, 'glossary.json', c);
  assert.equal(withGlossary.progress.profile.role, '');
  assert.equal(installOn(withGlossary, 'pack-bakery.json', c).progress.profile.role, '');
});

test("a track's role, or its title where it has none", () => {
  assert.equal(roleOf(asObject('track-bakery.json')), 'Baker');
  assert.equal(roleOf(asObject('track-pastry.json')), 'Pastry cook');
  assert.equal(roleOf({ title: 'Pastry cook', role: '   ' }), 'Pastry cook');
  assert.equal(roleOf(null), '');
});

test('installing a track writes its role, alone or in a bundle', () => {
  const c = clock();
  assert.equal(installOn(newPhone(c), 'track-bakery.json', c).progress.profile.role, 'Baker');
  assert.equal(installOn(newPhone(c), 'bundle-bakery.json', c).progress.profile.role, 'Baker');
  assert.equal(installOn(newPhone(c), 'track-pastry.json', c).progress.profile.role, 'Pastry cook');
});

test('a different track, or a newer version of the same one, replaces the role', () => {
  const c = clock();
  const baker = installOn(newPhone(c), 'bundle-bakery.json', c);
  assert.equal(baker.progress.profile.role, 'Baker');
  // A different track.
  const pastry = installOn(baker, 'track-pastry.json', c);
  assert.equal(pastry.progress.profile.role, 'Pastry cook');
  // A newer version of the same track, with a new role.
  const renamed = installOn(baker, track({ trackVersion: '1.5', role: 'Head baker' }), c);
  assert.equal(renamed.progress.profile.role, 'Head baker');
  // The next bundle brings the baker track at 1.1: a newer version, so its role is written.
  const typed = { ...baker, progress: { ...baker.progress, profile: { ...baker.progress.profile, role: 'Typed earlier' } } };
  assert.equal(installOn(typed, 'bundle-bakery-next.json', c).progress.profile.role, 'Baker');
});

test('nothing else changes the role: a removal, the same bundle again, or a bundle whose track is older', () => {
  const c = clock();
  const next = installOn(newPhone(c), 'bundle-bakery-next.json', c);
  const typed = { ...next, progress: { ...next.progress, profile: { ...next.progress.profile, role: 'Typed earlier' } } };
  // A removal.
  const remove = planRemove('pastry_basics', typed.content);
  const removed = progressAfter(typed.progress, remove.nextContent, c, ENGINE);
  assert.equal(removed.profile.role, 'Typed earlier');
  // The same bundle again, which brings the removed pack back and the same track.
  const again = installOn({ content: remove.nextContent, progress: removed }, 'bundle-bakery-next.json', c);
  assert.equal(again.progress.profile.role, 'Typed earlier');
  // Another bundle carrying an older version of the same track: the newer track stays.
  const other = { kind: 'bundle', data: { ...asObject('bundle-bakery.json'), bundleId: 'bakery-other' } };
  const older = planImport(other, { content: typed.content, progress: typed.progress, engineVersion: ENGINE, random: seededRandom(3) });
  assert.equal(older.ok, true, older.message);
  assert.equal(older.nextContent.track.trackVersion, '1.1');
  assert.equal(progressAfter(typed.progress, older.nextContent, c, ENGINE).profile.role, 'Typed earlier');
});

test('a role typed under an earlier engine stays until a track is installed', () => {
  const c = clock();
  const earlier = { content: emptyContent(), progress: newProgress({ name: 'Sam', role: 'Typed earlier' }, c, ENGINE, seededRandom(1)) };
  assert.equal(installOn(earlier, 'glossary.json', c).progress.profile.role, 'Typed earlier');
  assert.equal(installOn(earlier, 'track-bakery.json', c).progress.profile.role, 'Baker');
});

test('the report reads "Role: not set" while there is no role, and the role once a track gives one', () => {
  const c = clock();
  const phone = newPhone(c);
  assert.match(buildReport(phone.progress, phone.content, c, ENGINE, APP_NAME).text, /^Learner: Sam · Role: not set · Track: none$/m);
  const baker = installOn(phone, 'bundle-bakery.json', c);
  assert.match(buildReport(baker.progress, baker.content, c, ENGINE, APP_NAME).text, /^Learner: Sam · Role: Baker · Track: Baker \(baker 1\.0\)$/m);
});
