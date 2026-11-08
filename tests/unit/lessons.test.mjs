import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentLessonId, firstOpenLesson, lessonOrder, positionAfterUpdate } from '../../engine/lessons.js';
import { fixture } from './fixtures.mjs';

const lessonIds = (order) => order.lessons.map((e) => e.lesson.lessonId);
const packs = (...list) => Object.fromEntries(list.map((p) => [p.packId, p]));

// A second invented pack, built from the first with its own ids.
function secondPack(order = 2) {
  const p = fixture('pack-bakery.json');
  p.packId = 'bakery_more';
  p.title = 'More bread';
  p.order = order;
  for (const lesson of p.lessons) {
    lesson.lessonId = lesson.lessonId.replace('bk_', 'bm_');
    lesson.prerequisites = (lesson.prerequisites || []).map((id) => id.replace('bk_', 'bm_'));
    for (const card of lesson.cards) card.cardId = card.cardId.replace('bk_', 'bm_');
  }
  return p;
}

const start = () => ({ currentLesson: null, currentCardIndex: 0, lessonsCompleted: [], catchingUp: false });

test("lessons follow the track's packs in its order, each pack's lessons by order, unverified passed over (test 32)", () => {
  const track = { ...fixture('track-bakery.json'), packs: ['bakery_more', 'bakery_basics'] };
  const order = lessonOrder({ track, packs: packs(fixture('pack-bakery.json'), secondPack()) });
  assert.deepEqual(lessonIds(order), ['bm_l01', 'bm_l02', 'bk_l01', 'bk_l02']);
  assert.equal(order.stoppedAt, null);
  assert.equal(order.lessons[0].packTitle, 'More bread');
  // The bundle's own track: the first lesson is the current one for a new learner.
  const bundle = fixture('bundle-bakery.json');
  const bundleOrder = lessonOrder({ track: bundle.track, packs: packs(...bundle.packs) });
  assert.deepEqual(lessonIds(bundleOrder), ['bk_l01', 'bk_l02']);
  assert.equal(currentLessonId(bundleOrder, start()), 'bk_l01');
});

test("with no track, packs go by their own order; a pack outside the track isn't in it", () => {
  const order = lessonOrder({ track: null, packs: packs(secondPack(0), fixture('pack-bakery.json')) });
  assert.deepEqual(lessonIds(order), ['bm_l01', 'bm_l02', 'bk_l01', 'bk_l02']);
  const tracked = lessonOrder({ track: fixture('track-bakery.json'), packs: packs(secondPack(0), fixture('pack-bakery.json')) });
  assert.deepEqual(lessonIds(tracked), ['bk_l01', 'bk_l02']);
});

test('the order stops where the track reaches a pack that is not installed', () => {
  const track = { ...fixture('track-bakery.json'), packs: ['bakery_basics', 'bakery_more', 'bakery_last'] };
  const order = lessonOrder({ track, packs: packs(fixture('pack-bakery.json')) });
  assert.deepEqual(lessonIds(order), ['bk_l01', 'bk_l02']);
  assert.equal(order.stoppedAt, 'bakery_more');
  const none = lessonOrder({ track, packs: {} });
  assert.deepEqual(none, { lessons: [], stoppedAt: 'bakery_basics' });
});

test('the current lesson is the stored one, or else the first not completed', () => {
  const order = lessonOrder({ track: fixture('track-bakery.json'), packs: packs(fixture('pack-bakery.json')) });
  assert.equal(firstOpenLesson(order, { ...start(), lessonsCompleted: ['bk_l01'] }), 'bk_l02');
  assert.equal(firstOpenLesson(order, { ...start(), lessonsCompleted: ['bk_l01', 'bk_l02'] }), null);
  assert.equal(currentLessonId(order, { ...start(), currentLesson: 'bk_l02' }), 'bk_l02');
});

test('after a content update, a lesson that has gone moves the position to the first open lesson', () => {
  const content = { track: fixture('track-bakery.json'), packs: packs(fixture('pack-bakery.json')) };
  const gone = { ...start(), currentLesson: 'bk_l07', currentCardIndex: 4, lessonsCompleted: ['bk_l01'] };
  assert.deepEqual(positionAfterUpdate(gone, content), { ...gone, currentLesson: 'bk_l02', currentCardIndex: 0 });
  // A pack removed: its lessons have gone, and with nothing open the position is null.
  const removed = { ...start(), currentLesson: 'bk_l02', currentCardIndex: 3 };
  assert.deepEqual(positionAfterUpdate(removed, { track: content.track, packs: {} }), { ...removed, currentLesson: null, currentCardIndex: 0 });
});

test('after a content update, a lesson now unverified is passed over too', () => {
  const p = fixture('pack-bakery.json');
  p.lessons[1].verification.status = 'unverified';
  const position = { ...start(), currentLesson: 'bk_l02', currentCardIndex: 2, lessonsCompleted: ['bk_l01'] };
  const after = positionAfterUpdate(position, { track: fixture('track-bakery.json'), packs: packs(p) });
  assert.deepEqual(after, { ...position, currentLesson: null, currentCardIndex: 0 });
});

test('after a content update, a card index past the end completes the lesson and moves on', () => {
  const next = fixture('pack-bakery-next.json');
  const content = { track: fixture('track-bakery.json'), packs: packs(next) };
  const l02 = next.lessons.find((l) => l.lessonId === 'bk_l02');
  const position = { ...start(), currentLesson: 'bk_l01', currentCardIndex: 10, lessonsCompleted: [] };
  assert.equal(next.lessons[0].cards.length, 10);
  assert.deepEqual(positionAfterUpdate(position, content), {
    ...position,
    currentLesson: 'bk_l02',
    currentCardIndex: 0,
    lessonsCompleted: ['bk_l01'],
  });
  const last = { ...start(), currentLesson: 'bk_l02', currentCardIndex: l02.cards.length, lessonsCompleted: ['bk_l01'] };
  assert.deepEqual(positionAfterUpdate(last, content), {
    ...last,
    currentLesson: null,
    currentCardIndex: 0,
    lessonsCompleted: ['bk_l01', 'bk_l02'],
  });
});

test('a position still inside its lesson, or null, is left alone', () => {
  const content = { track: fixture('track-bakery.json'), packs: packs(fixture('pack-bakery-next.json')) };
  const inside = { ...start(), currentLesson: 'bk_l01', currentCardIndex: 9 };
  assert.equal(positionAfterUpdate(inside, content), inside);
  const fresh = start();
  assert.equal(positionAfterUpdate(fresh, content), fresh);
  // A lesson still installed counts as existing even where the track stops before it.
  const track = { ...fixture('track-bakery.json'), packs: ['bakery_gone', 'bakery_basics'] };
  const beyond = { ...start(), currentLesson: 'bk_l02', currentCardIndex: 3 };
  assert.equal(positionAfterUpdate(beyond, { track, packs: content.packs }), beyond);
});
