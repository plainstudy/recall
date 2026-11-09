import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recognise } from '../../engine/formats.js';
import { emptyContent, planImport, planRemove, progressAfter } from '../../engine/importing.js';
import { lessonOrder, currentLessonId } from '../../engine/lessons.js';
import { newProgress } from '../../engine/progress.js';
import { MESSAGES } from '../../engine/validate.js';
import { clockAt } from './clock.mjs';
import { fixture, fixtureText, seasonedProgress } from './fixtures.mjs';
import { seededRandom } from './seeded.mjs';

const ENGINE = '0.2.0';

// Imports a fixture over the given phone state, as Install does: { content, progress }.
function install(state, name, clock) {
  const plan = planImport(recognise(fixtureText(name)), { ...state, engineVersion: ENGINE });
  assert.equal(plan.ok, true, plan.message);
  return { plan, state: { content: plan.nextContent, progress: progressAfter(state.progress, plan.nextContent, clock, ENGINE) } };
}

function freshPhone(clock) {
  return { content: emptyContent(), progress: newProgress({ name: 'Sam', role: 'Baker' }, clock, ENGINE, seededRandom(1)) };
}

test('a bundle installs its glossary, pack and track in one import, and lessons follow the track (test 32)', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  const { plan, state } = install(freshPhone(clock), 'bundle-bakery.json', clock);
  assert.deepEqual(plan.lines, ['Bundle Bakery School 1.0: glossary 1.1, new, with 6 terms; pack Bread basics 1.0, new; track Baker 1.0, new.']);
  assert.deepEqual(
    plan.writes.put.map(([key]) => key),
    ['bundle', 'glossary', 'pack:bakery_basics', 'track'],
  );
  assert.equal(plan.done, 'Bundle Bakery School 1.0 installed.');
  assert.ok(!('packs' in state.content.bundle) && !('glossary' in state.content.bundle), 'the bundle is kept without its parts');
  assert.deepEqual(state.progress.installed, {
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
  const order = lessonOrder(state.content);
  assert.deepEqual(order.lessons.map((e) => e.lesson.lessonId), ['bk_l01', 'bk_l02']);
  assert.equal(currentLessonId(order, state.progress.position), 'bk_l01');
  assert.deepEqual(plan.warnings, [
    'Pack bakery_basics, card bk_l02_c01: its figure "fig_not_in_pack" isn\'t in the pack, so the card shows without it.',
    'Pack bakery_basics: 1 lesson is marked needs-review.',
  ]);
});

test('a newer pack replaces the old one and every atom keeps its box and due date (test 10)', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  let { state } = install(freshPhone(clock), 'bundle-bakery.json', clock);
  state = { ...state, progress: seasonedProgress(state.progress) };
  const atomsBefore = structuredClone(state.progress.atoms);
  clock.set('2026-11-16T08:00:00+03:00');
  const next = install(state, 'pack-bakery-next.json', clock);
  assert.deepEqual(next.plan.lines, ['Pack Bread basics 1.0 → 1.1.', 'Your progress stays.']);
  assert.deepEqual(next.state.progress.atoms, atomsBefore);
  assert.ok(next.state.progress.atoms['atom.technique.scoring'], 'the atom whose card left stays');
  assert.equal(next.state.progress.installed.packs.bakery_basics, '1.1');
  assert.equal(next.state.progress.savedOn, '2026-11-16T08:00:00+03:00');
  assert.deepEqual(next.state.progress.streak, state.progress.streak);
  assert.deepEqual(next.state.progress.position, state.progress.position);
});

test('a newer glossary adds, changes and retires terms by id without changing progress (test 30)', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  let { state } = install(freshPhone(clock), 'bundle-bakery.json', clock);
  state = { ...state, progress: seasonedProgress(state.progress) };
  const next = install(state, 'glossary-next.json', clock);
  assert.deepEqual(next.plan.lines, ['Glossary 1.1 → 1.2, with 1 new, 1 changed and 1 retired.', 'Your progress stays.']);
  const { savedOn, installed, ...rest } = next.state.progress;
  const { savedOn: s0, installed: i0, ...before } = state.progress;
  assert.deepEqual(rest, before);
  assert.equal(installed.glossaryVersion, '1.2');
  // The older one is now refused.
  const older = planImport(recognise(fixtureText('glossary.json')), { ...next.state, engineVersion: ENGINE });
  assert.equal(older.ok, false);
  assert.equal(older.message, MESSAGES.older('glossary', '1.1', '1.2'));
});

test('the same file again is already installed; a refusal gives the first problem and the count', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  const { state } = install(freshPhone(clock), 'bundle-bakery.json', clock);
  const again = planImport(recognise(fixtureText('bundle-bakery.json')), { ...state, engineVersion: ENGINE });
  assert.deepEqual([again.ok, again.message, again.more], [false, MESSAGES.alreadyInstalled('bundle', '1.0'), 0]);
  const broken = fixture('pack-bakery-next.json');
  broken.contentClass = 'secret';
  broken.lessons[0].cards[1].type = 'flashcard';
  const refused = planImport({ kind: 'pack', data: broken }, { ...state, engineVersion: ENGINE });
  assert.deepEqual([refused.ok, refused.message, refused.more], [false, 'The pack: contentClass must be "public" or "private".', 1]);
  assert.equal(refused.problems.length, 2);
});

test('a different bundle switches the track after a confirmation, and progress stays (test 32)', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  let { state } = install(freshPhone(clock), 'bundle-bakery.json', clock);
  state = { ...state, progress: seasonedProgress(state.progress) };
  const other = fixture('bundle-bakery.json');
  other.bundleId = 'pastry-school';
  other.title = 'Pastry School';
  other.track = { ...other.track, trackId: 'pastry-cook', title: 'Pastry cook', packs: ['bakery_basics'] };
  other.packs = [fixture('pack-bakery-next.json')];
  other.glossary = fixture('glossary-next.json');
  const plan = planImport({ kind: 'bundle', data: other }, { ...state, engineVersion: ENGINE });
  assert.equal(plan.ok, true, plan.message);
  assert.deepEqual(plan.lines, [
    'Bundle Pastry School 1.0: glossary 1.1 → 1.2, with 1 new, 1 changed and 1 retired; pack Bread basics 1.0 → 1.1; track Pastry cook 1.0, in place of Baker 1.0.',
    'This replaces the bundle Bakery School, and your track with its own. Your progress stays.',
  ]);
  const after = progressAfter(state.progress, plan.nextContent, clock, ENGINE);
  assert.equal(after.installed.bundleId, 'pastry-school');
  assert.equal(after.installed.trackId, 'pastry-cook');
  assert.deepEqual(after.atoms, state.progress.atoms);
  assert.deepEqual(after.streak, state.progress.streak);
});

test('the same bundle brings back a pack that was removed; Remove keeps progress', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  let { state } = install(freshPhone(clock), 'bundle-bakery.json', clock);
  state = { ...state, progress: seasonedProgress(state.progress) };
  const removal = planRemove('bakery_basics', state.content);
  assert.deepEqual(removal.lines, ['Remove the pack Bread basics? Your progress stays, and importing the pack again brings it back.']);
  assert.deepEqual(removal.writes, { put: [], remove: ['pack:bakery_basics'] });
  const removed = { content: removal.nextContent, progress: progressAfter(state.progress, removal.nextContent, clock, ENGINE) };
  assert.deepEqual(removed.progress.atoms, state.progress.atoms);
  assert.deepEqual(removed.progress.installed.packs, {});
  assert.equal(removed.progress.position.currentLesson, null, 'its lessons have gone, so the position moves');
  assert.deepEqual(removed.progress.position.lessonsCompleted, ['bk_l01']);
  const back = install(removed, 'bundle-bakery.json', clock);
  assert.deepEqual(back.plan.lines, [
    'Bundle Bakery School 1.0: glossary unchanged; pack Bread basics 1.0, new; track unchanged.',
    'Your progress stays.',
  ]);
  assert.deepEqual(back.plan.writes.put.map(([key]) => key), ['bundle', 'pack:bakery_basics']);
  assert.equal(currentLessonId(lessonOrder(back.state.content), back.state.progress.position), 'bk_l02');
});

test('a bundle keeps a newer glossary, pack or track already on the phone, and installs the rest', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  // The glossary update arrived before the bundle.
  let { state } = install(freshPhone(clock), 'glossary-next.json', clock);
  const bundle = install(state, 'bundle-bakery.json', clock);
  assert.deepEqual(bundle.plan.lines, [
    "Bundle Bakery School 1.0: glossary 1.2 kept, newer than the bundle's 1.1; pack Bread basics 1.0, new; track Baker 1.0, new.",
  ]);
  assert.deepEqual(bundle.plan.writes.put.map(([key]) => key), ['bundle', 'pack:bakery_basics', 'track']);
  assert.equal(bundle.state.content.glossary.glossaryVersion, '1.2');
  assert.equal(bundle.state.progress.installed.glossaryVersion, '1.2');
  assert.deepEqual(lessonOrder(bundle.state.content).lessons.map((e) => e.lesson.lessonId), ['bk_l01', 'bk_l02']);

  // A newer pack and a newer track already installed stay as well.
  ({ state } = install(freshPhone(clock), 'glossary.json', clock));
  ({ state } = install(state, 'pack-bakery-next.json', clock));
  const newerTrack = { ...fixture('track-bakery.json'), trackVersion: '1.1' };
  const withTrack = planImport({ kind: 'track', data: newerTrack }, { ...state, engineVersion: ENGINE });
  state = { content: withTrack.nextContent, progress: progressAfter(state.progress, withTrack.nextContent, clock, ENGINE) };
  const again = install(state, 'bundle-bakery.json', clock);
  assert.deepEqual(again.plan.lines, [
    "Bundle Bakery School 1.0: glossary unchanged; pack Bread basics 1.1 kept, newer than the bundle's 1.0; track Baker 1.1 kept, newer than the bundle's 1.0.",
  ]);
  assert.deepEqual(again.plan.writes.put.map(([key]) => key), ['bundle']);
  assert.equal(again.state.content.packs.bakery_basics.packVersion, '1.1');
  assert.equal(again.state.progress.installed.trackVersion, '1.1');
  // A glossary on its own, older than the installed one, is still refused (test 30).
  const older = planImport(recognise(fixtureText('glossary.json')), { ...bundle.state, engineVersion: ENGINE });
  assert.equal(older.message, MESSAGES.older('glossary', '1.1', '1.2'));
});

test('a pack on its own needs the glossary installed first', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  const phone = freshPhone(clock);
  const refused = planImport(recognise(fixtureText('pack-bakery.json')), { ...phone, engineVersion: ENGINE });
  assert.equal(refused.message, `The pack: ${MESSAGES.noGlossary}`);
  const { state } = install(phone, 'glossary.json', clock);
  const { plan } = install(state, 'pack-bakery.json', clock);
  assert.deepEqual(plan.lines, ['Pack Bread basics 1.0, new.']);
  const track = install(state, 'track-bakery.json', clock);
  assert.deepEqual(track.plan.lines, ['Track Baker 1.0, new.']);
});
