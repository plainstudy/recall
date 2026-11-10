import assert from 'node:assert/strict';
import { test } from 'node:test';
import { learnerDay } from '../../engine/days.js';
import { checkStreak, countDay } from '../../engine/streak.js';
import { clockAt } from './clock.mjs';

const fresh = () => ({
  current: 0,
  longest: 0,
  lastCountedDay: null,
  checkedThrough: null,
  freezesRemaining: 2,
  freezesUsedOn: [],
  countedRun: 0,
  dayBoundaryHour: 4,
});

// Counts each of these days in turn.
const counting = (streak, ...days) => days.reduce((s, day) => countDay(s, day), streak);

test('a new learner starts with two freezes, and the first completed session counts day one', () => {
  const s = countDay(fresh(), '2026-11-10');
  assert.deepEqual(s, { ...fresh(), current: 1, longest: 1, lastCountedDay: '2026-11-10', countedRun: 1 });
  const before = fresh();
  assert.equal(checkStreak(before, '2026-12-25'), before, 'before the first counted day there is nothing to check');
});

test('a day counts once: a second session the same day adds nothing', () => {
  const once = countDay(fresh(), '2026-11-10');
  const twice = countDay(once, '2026-11-10');
  assert.equal(twice, once);
  const next = countDay(twice, '2026-11-11');
  assert.deepEqual([next.current, next.longest, next.lastCountedDay, next.countedRun], [2, 2, '2026-11-11', 2]);
});

test('missing one day uses a freeze, and missing another with none left resets the streak to 0 (test 8)', () => {
  let s = counting(fresh(), '2026-11-10', '2026-11-11', '2026-11-12');
  s = { ...s, freezesRemaining: 1 };
  // The 13th is missed. Opening the app on the 14th finds it.
  s = checkStreak(s, '2026-11-14');
  assert.deepEqual(
    [s.current, s.freezesRemaining, s.freezesUsedOn, s.checkedThrough, s.countedRun],
    [3, 0, ['2026-11-13'], '2026-11-13', 0],
    'a day covered by a freeze leaves the streak as it was',
  );
  // The 14th is missed too, with no freeze left.
  s = checkStreak(s, '2026-11-15');
  assert.deepEqual([s.current, s.longest, s.freezesRemaining, s.freezesUsedOn, s.checkedThrough], [0, 3, 0, ['2026-11-13'], '2026-11-14']);
  // Completing a session then starts again at 1.
  s = countDay(s, '2026-11-15');
  assert.deepEqual([s.current, s.longest, s.lastCountedDay, s.countedRun], [1, 3, '2026-11-15', 1]);
});

test('a day covered by a freeze neither adds to the streak nor breaks it', () => {
  let s = counting(fresh(), '2026-11-10', '2026-11-11');
  s = countDay(s, '2026-11-13'); // the 12th was missed
  assert.deepEqual([s.current, s.longest, s.freezesRemaining, s.freezesUsedOn, s.checkedThrough], [3, 3, 1, ['2026-11-12'], '2026-11-12']);
  assert.equal(s.countedRun, 1, 'using a freeze starts the run of counted days again');
});

test('no day is checked twice, however often the check runs', () => {
  let s = counting(fresh(), '2026-11-10');
  const first = checkStreak(s, '2026-11-12');
  assert.deepEqual([first.freezesRemaining, first.checkedThrough], [1, '2026-11-11']);
  assert.equal(checkStreak(first, '2026-11-12'), first, 'the same day again changes nothing');
  assert.equal(checkStreak(checkStreak(first, '2026-11-12'), '2026-11-12'), first);
  s = checkStreak(first, '2026-11-13');
  assert.deepEqual([s.freezesRemaining, s.freezesUsedOn, s.checkedThrough], [0, ['2026-11-11', '2026-11-12'], '2026-11-12']);
  // The day it was last counted, and the day after, have nothing to check.
  const counted = counting(fresh(), '2026-11-10');
  assert.equal(checkStreak(counted, '2026-11-10'), counted);
  assert.equal(checkStreak(counted, '2026-11-11'), counted, 'yesterday was counted');
});

test('after a long absence the freezes go first, then one reset; further missed days change nothing more', () => {
  const s = checkStreak(counting(fresh(), '2026-11-08', '2026-11-09', '2026-11-10'), '2027-03-01');
  assert.deepEqual(s, {
    current: 0,
    longest: 3,
    lastCountedDay: '2026-11-10',
    checkedThrough: '2027-02-28',
    freezesRemaining: 0,
    freezesUsedOn: ['2026-11-11', '2026-11-12'],
    countedRun: 0,
    dayBoundaryHour: 4,
  });
});

test('a freeze comes back after seven counted days in a row, and never more than two are held', () => {
  const days = (from, n) => Array.from({ length: n }, (_, i) => `2026-11-${String(from + i).padStart(2, '0')}`);
  // Holding two already: seven days bring none, and the run starts again.
  let s = counting(fresh(), ...days(1, 7));
  assert.deepEqual([s.current, s.freezesRemaining, s.countedRun], [7, 2, 0]);
  // Holding none: one comes back at seven, a second at fourteen, and no third.
  s = counting({ ...fresh(), freezesRemaining: 0 }, ...days(1, 6));
  assert.deepEqual([s.freezesRemaining, s.countedRun], [0, 6]);
  s = countDay(s, '2026-11-07');
  assert.deepEqual([s.freezesRemaining, s.countedRun], [1, 0]);
  s = counting(s, ...days(8, 7));
  assert.deepEqual([s.current, s.freezesRemaining, s.countedRun], [14, 2, 0]);
  s = counting(s, ...days(15, 7));
  assert.deepEqual([s.current, s.freezesRemaining], [21, 2]);
  // A freeze used part-way sets the run back to 0, so the next one is seven days on.
  s = counting({ ...fresh(), freezesRemaining: 1 }, ...days(1, 5));
  s = countDay(s, '2026-11-07'); // the 6th missed
  assert.deepEqual([s.freezesRemaining, s.countedRun, s.current], [0, 1, 6]);
  s = counting(s, ...days(8, 5));
  assert.equal(s.freezesRemaining, 0);
  s = countDay(s, '2026-11-13');
  assert.deepEqual([s.freezesRemaining, s.countedRun], [1, 0]);
});

test('the day starts at 04:00: a session at 01:00 counts for the day before', () => {
  const clock = clockAt('2026-11-10T23:30:00+03:00');
  let s = countDay(fresh(), learnerDay(clock));
  assert.equal(s.lastCountedDay, '2026-11-10');
  clock.set('2026-11-11T01:00:00+03:00');
  assert.equal(learnerDay(clock), '2026-11-10');
  assert.equal(countDay(s, learnerDay(clock)), s, 'still the 10th: counted already');
  clock.set('2026-11-11T03:59:59+03:00');
  assert.equal(countDay(s, learnerDay(clock)), s);
  clock.set('2026-11-11T04:00:00+03:00');
  s = countDay(s, learnerDay(clock));
  assert.deepEqual([s.current, s.lastCountedDay], [2, '2026-11-11']);
  // A session at 01:00 on the 13th counts for the 12th, so no day was missed.
  clock.set('2026-11-13T01:00:00+03:00');
  s = countDay(s, learnerDay(clock));
  assert.deepEqual([s.current, s.lastCountedDay, s.freezesRemaining], [3, '2026-11-12', 2]);
});

test('a change of time zone can shift a day but never counts one twice', () => {
  // Counted on the 11th, far east of home.
  const clock = clockAt('2026-11-11T06:00:00+12:00');
  let s = countDay(countDay(fresh(), '2026-11-10'), learnerDay(clock));
  assert.deepEqual([s.current, s.lastCountedDay], [2, '2026-11-11']);
  // Twelve hours later, far west: the phone's date is the 10th again.
  clock.set('2026-11-10T20:00:00-10:00');
  assert.equal(learnerDay(clock), '2026-11-10');
  assert.equal(countDay(s, learnerDay(clock)), s, 'an earlier date adds nothing');
  assert.equal(checkStreak(s, learnerDay(clock)), s, 'and the check has nothing to do');
  // The next day there, the 11th again by the phone: still counted.
  clock.set('2026-11-11T20:00:00-10:00');
  assert.equal(countDay(s, learnerDay(clock)), s);
  clock.set('2026-11-12T20:00:00-10:00');
  s = countDay(s, learnerDay(clock));
  assert.deepEqual([s.current, s.lastCountedDay, s.freezesRemaining], [3, '2026-11-12', 2]);
});

test('the check never moves backwards', () => {
  const s = checkStreak(counting(fresh(), '2026-11-10'), '2026-11-14');
  assert.equal(s.checkedThrough, '2026-11-13');
  assert.equal(checkStreak(s, '2026-11-12'), s);
});
