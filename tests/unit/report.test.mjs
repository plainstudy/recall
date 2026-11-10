import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findProgressBlock, recognise } from '../../engine/formats.js';
import { emptyContent, planImport, progressAfter } from '../../engine/importing.js';
import { checkProgress, newProgress, PROGRESS_MESSAGES, restoredProgress } from '../../engine/progress.js';
import { buildReport, learnerSlug, reportFileName, reportPeriod, withReportMarks } from '../../engine/report.js';
import { APP_NAME } from '../../ui/app-name.js';
import { clockAt } from './clock.mjs';
import { asSchemaTwo, fixtureText, seasonedProgress } from './fixtures.mjs';
import { seededRandom } from './seeded.mjs';

const ENGINE = '0.3.0';

// A phone with the bakery bundle and a learner part-way through.
function bakeryPhone(clock) {
  const progress = newProgress({ name: 'Sam Baker' }, clock, ENGINE, seededRandom(1));
  progress.profile.createdOn = '2026-11-01';
  const plan = planImport(recognise(fixtureText('bundle-bakery.json')), { content: emptyContent(), progress, engineVersion: ENGINE });
  const after = progressAfter(progress, plan.nextContent, clock, ENGINE);
  return { content: plan.nextContent, progress: seasonedProgress(after) };
}

test('the file name: prefix, learner and day, with the learner cleaned up', () => {
  assert.equal(reportFileName('Bakery_School', 'Sam Baker', '2026-11-15'), 'Bakery_School_Report_Sam-Baker_2026-11-15.md');
  assert.equal(reportFileName(null, 'Sam', '2026-11-15'), 'Report_Sam_2026-11-15.md');
  assert.equal(learnerSlug("  Jo O'Neil-Smith  "), 'Jo-ONeil-Smith');
  assert.equal(learnerSlug('Ана Мария'), 'Ана-Мария', 'letters in any script count');
  assert.equal(learnerSlug('Владимир Александрович Петров'), 'Владимир-Александрович-П', 'at most 24 characters');
  assert.equal(learnerSlug('!!!'), 'learner');
  assert.equal(learnerSlug(''), 'learner');
});

test('the period runs from the last report, at most 28 days, or from the start for the first', () => {
  const p = { profile: { createdOn: '2026-11-01' }, reportsSavedOn: [] };
  assert.deepEqual(reportPeriod(p, '2026-11-15'), { from: '2026-11-01', to: '2026-11-15' });
  assert.deepEqual(reportPeriod({ ...p, reportsSavedOn: ['2026-11-08'] }, '2026-11-15'), { from: '2026-11-08', to: '2026-11-15' });
  assert.deepEqual(reportPeriod({ ...p, reportsSavedOn: ['2026-09-01'] }, '2026-11-15'), { from: '2026-10-18', to: '2026-11-15' });
});

test('the report names the learner, role and track, and has every section (test 33)', () => {
  const clock = clockAt('2026-11-15T07:20:00+03:00');
  const phone = bakeryPhone(clock);
  const { fileName, text } = buildReport(phone.progress, phone.content, clock, ENGINE);
  assert.equal(fileName, 'Bakery_School_Report_Sam-Baker_2026-11-15.md');
  const lines = text.split('\n');
  assert.equal(lines[0], '# Bakery School — weekly report');
  // The role is the one the bundle's track gave.
  assert.equal(lines[2], 'Learner: Sam Baker · Role: Baker · Track: Baker (baker 1.0)');
  assert.equal(lines[3], 'Period: 2026-11-08 to 2026-11-15 · Saved 2026-11-15 07:20 · Engine 0.3.0 · Glossary 1.1');
  for (const heading of ['## Sessions', '## Accuracy by family', '## Top confusions', '## Failing atoms', '## Requested terms', '## Position', '## Full progress data']) {
    assert.ok(lines.includes(heading), heading);
  }
  const visible = text.split('## Full progress data')[0];
  assert.ok(text.includes('2 daily sessions on 2 days. Streak 5, longest 9, freezes left 1.'));
  assert.ok(text.includes('| 2026-11-14 (redo) | 0 min | 6 | 6 | 0 of 0 |'));
  assert.ok(!visible.includes('2026-10-01'), 'sessions before the period are left out');
  assert.ok(text.includes('| Leavening | 7 | 4 | 57% |'));
  assert.ok(text.includes('| Shaping | 2 | 2 | 100% |'));
  assert.ok(text.includes('| Term | Confused with | Times |'), 'the pairs have no direction');
  assert.ok(text.includes('| Levain | Poolish | 2 |'));
  assert.ok(text.includes('| Banneton | Couche | 1 |'));
  assert.ok(text.includes('| atom.ingredient.poolish | At the oven (bk_l02) | 3 | bk_l02_c04 |'));
  assert.ok(text.includes('| atom.technique.scoring | At the oven (bk_l02) | 2 | bk_l02_c06 |'));
  assert.ok(!visible.includes('| atom.ingredient.levain |'), 'one wrong answer is not failing');
  assert.ok(visible.includes('- "crumb shot", 2026-11-13'));
  assert.ok(!visible.includes('autolyse'), 'requests already reported are not listed again');
  assert.ok(text.includes('Lesson 2 of 2 in the track: At the oven (bk_l02), card 4 of 7.'));
});

test('a learner with nothing yet gets a plain report', () => {
  const clock = clockAt('2026-11-15T07:20:00+03:00');
  const progress = newProgress({ name: 'Sam' }, clock, ENGINE, seededRandom(1));
  const { fileName, text } = buildReport(progress, emptyContent(), clock, ENGINE, APP_NAME);
  assert.equal(fileName, 'Report_Sam_2026-11-15.md');
  assert.ok(text.startsWith(`# ${APP_NAME} — weekly report\n\nLearner: Sam · Role: not set · Track: none\n`));
  assert.ok(text.includes('· Glossary none'));
  for (const empty of ['No daily sessions in this period.', 'No answers in this period.', 'None recorded.', 'No lessons installed.']) {
    assert.ok(text.includes(empty), empty);
  }
});

test('the progress block carries the report marks, and round-trips exactly (test 20)', () => {
  const clock = clockAt('2026-11-15T07:20:00+03:00');
  const phone = bakeryPhone(clock);
  const { text, marked } = buildReport(phone.progress, phone.content, clock, ENGINE);
  const block = JSON.parse(findProgressBlock(text));
  assert.deepEqual(block, marked);
  assert.deepEqual(block.reportsSavedOn, ['2026-11-08', '2026-11-15']);
  assert.deepEqual(block.termRequests, [
    { text: 'crumb shot', on: '2026-11-13', reportedOn: '2026-11-15' },
    { text: 'autolyse', on: '2026-11-01', reportedOn: '2026-11-08' },
  ]);
  assert.deepEqual(withReportMarks(phone.progress, '2026-11-15').reportsSavedOn, ['2026-11-08', '2026-11-15']);
  assert.deepEqual(withReportMarks(withReportMarks(phone.progress, '2026-11-15'), '2026-11-15').reportsSavedOn, ['2026-11-08', '2026-11-15']);

  // Restored on a wiped phone the same day, after the bundle: streak, position and every
  // atom as saved.
  clock.set('2026-11-15T09:00:00+03:00');
  const fresh = newProgress({ name: 'Test', role: 'Test' }, clock, ENGINE, seededRandom(2));
  const bundle = planImport(recognise(fixtureText('bundle-bakery.json')), { content: emptyContent(), progress: fresh, engineVersion: ENGINE });
  const wiped = progressAfter(fresh, bundle.nextContent, clock, ENGINE);
  const plan = planImport(recognise(text), { content: bundle.nextContent, progress: wiped, engineVersion: ENGINE, random: seededRandom(3) });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.lines, ["Restore Sam Baker's progress from 15 November 2026? This replaces the progress on this phone."]);
  const restored = restoredProgress(wiped, plan.fromReport, clock, ENGINE);
  assert.deepEqual(restored.streak, phone.progress.streak);
  assert.deepEqual(restored.position, phone.progress.position);
  assert.deepEqual(restored.atoms, phone.progress.atoms);
  assert.deepEqual(restored.profile, phone.progress.profile);
  assert.deepEqual(restored.sessionLog, phone.progress.sessionLog);
  assert.deepEqual(restored.installed, wiped.installed);
  assert.equal(restored.deviceId, wiped.deviceId, "this phone's own id stays");
});

test('a report from an older app restores: its progress is migrated, then checked (test 38)', () => {
  const clock = clockAt('2026-11-15T07:20:00+03:00');
  const phone = bakeryPhone(clock);
  const older = asSchemaTwo(phone.progress);
  const { text } = buildReport(older, phone.content, clock, '0.2.1');
  assert.ok(text.includes('"schemaVersion": 2'));
  for (const field of ['learnerId', 'deviceId', 'changedAt']) assert.ok(!text.includes(field), field);

  clock.set('2026-11-15T09:00:00+03:00');
  const fresh = newProgress({ name: 'Test', role: 'Test' }, clock, ENGINE, seededRandom(2));
  const bundle = planImport(recognise(fixtureText('bundle-bakery.json')), { content: emptyContent(), progress: fresh, engineVersion: ENGINE });
  const wiped = progressAfter(fresh, bundle.nextContent, clock, ENGINE);
  const plan = planImport(recognise(text), { content: bundle.nextContent, progress: wiped, engineVersion: ENGINE, random: seededRandom(3) });
  assert.equal(plan.ok, true, plan.message);
  assert.deepEqual(plan.lines, ["Restore Sam Baker's progress from 15 November 2026? This replaces the progress on this phone."]);
  const restored = restoredProgress(wiped, plan.fromReport, clock, ENGINE);
  assert.deepEqual(checkProgress(restored), { ok: true });
  assert.equal(restored.schemaVersion, 3);
  assert.equal(restored.deviceId, wiped.deviceId, "this phone's own id stays");
  assert.notEqual(restored.profile.learnerId, wiped.profile.learnerId, 'the report had no learner id, so the migration made one');
  // Nothing is lost: everything the older progress held is still there, as it was.
  const back = asSchemaTwo(restored);
  assert.deepEqual(back.profile, older.profile);
  for (const key of ['settings', 'streak', 'position', 'atoms', 'families', 'confusions', 'sessionLog']) assert.deepEqual(back[key], older[key], key);
});

test('a block whose text holds backticks still restores', () => {
  const clock = clockAt('2026-11-15T07:20:00+03:00');
  const progress = newProgress({ name: 'Sam', role: 'Baker' }, clock, ENGINE, seededRandom(1));
  progress.termRequests = [{ text: '```json progress', on: '2026-11-15', reportedOn: null }];
  const { text, marked } = buildReport(progress, emptyContent(), clock, ENGINE);
  assert.deepEqual(JSON.parse(findProgressBlock(text)), marked);
});

test('restore warns when the phone has newer progress with sessions, and refuses a newer app (tests 20, 33)', () => {
  const clock = clockAt('2026-11-15T07:20:00+03:00');
  const phone = bakeryPhone(clock);
  const { text } = buildReport(phone.progress, phone.content, clock, ENGINE);
  clock.set('2026-11-17T08:00:00+03:00');
  const newer = { ...phone.progress, savedOn: '2026-11-17T08:00:00+03:00' };
  const plan = planImport(recognise(text), { content: phone.content, progress: newer, engineVersion: ENGINE });
  assert.deepEqual(plan.lines, [
    "Restore Sam Baker's progress from 15 November 2026? This replaces the progress on this phone.",
    'The progress on this phone is newer, from 17 November 2026.',
  ]);
  const noSessions = { ...newer, sessionLog: [] };
  assert.equal(planImport(recognise(text), { content: phone.content, progress: noSessions, engineVersion: ENGINE }).lines.length, 1);

  const fromNewerApp = text.replace('"schemaVersion": 3', '"schemaVersion": 4');
  const refused = planImport(recognise(fromNewerApp), { content: phone.content, progress: newer, engineVersion: ENGINE });
  assert.deepEqual([refused.ok, refused.message], [false, PROGRESS_MESSAGES.newerApp]);
  const garbled = text.replace('"schemaVersion": 3', '"schemaVersion": 3,,');
  assert.equal(planImport(recognise(garbled), { content: phone.content, progress: newer, engineVersion: ENGINE }).message, PROGRESS_MESSAGES.mismatch);
});
