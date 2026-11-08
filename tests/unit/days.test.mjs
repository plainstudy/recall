import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  civilFromDays,
  daysBetween,
  daysFromCivil,
  instantOf,
  isDay,
  isStamp,
  learnerDay,
  localStamp,
  longDate,
  stampDay,
  stampText,
} from '../../engine/days.js';
import { clockAt } from './clock.mjs';

test('calendar arithmetic round-trips across centuries and leap days', () => {
  assert.equal(daysFromCivil(1970, 1, 1), 0);
  assert.equal(daysFromCivil(2000, 3, 1) - daysFromCivil(2000, 2, 28), 2);
  assert.equal(daysFromCivil(1900, 3, 1) - daysFromCivil(1900, 2, 28), 1);
  for (let n = -800_000; n <= 800_000; n += 997) {
    const { year, month, day } = civilFromDays(n);
    assert.equal(daysFromCivil(year, month, day), n);
  }
});

test('days add, subtract and count across months, years and leap days', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-15', -28), '2026-10-18');
  assert.equal(daysBetween('2026-11-08', '2026-11-15'), 7);
  assert.equal(daysBetween('2026-11-15', '2026-11-08'), -7);
  assert.ok(isDay('2028-02-29'));
  for (const d of ['2026-02-29', '2026-13-01', '2026-11-31', '26-11-15', '2026-1-5', null]) assert.ok(!isDay(d), String(d));
});

test("the learner's day starts at 04:00 local time", () => {
  const clock = clockAt('2026-11-16T03:59:59+03:00');
  assert.equal(learnerDay(clock), '2026-11-15');
  clock.set('2026-11-16T04:00:00+03:00');
  assert.equal(learnerDay(clock), '2026-11-16');
  clock.set('2026-11-16T00:30:00+03:00');
  assert.equal(learnerDay(clock), '2026-11-15');
  clock.set('2026-11-16T23:59:00-05:00');
  assert.equal(learnerDay(clock), '2026-11-16');
  // The same instant, on a phone in another zone, is a different local day.
  clock.set('2026-11-16T02:00:00+00:00');
  assert.equal(learnerDay(clock), '2026-11-15');
  assert.equal(learnerDay({ now: clock.now, offsetMinutes: () => 180 }), '2026-11-16');
});

test('local times are written with their offset, and read back as the same instant', () => {
  for (const stamp of ['2026-11-15T07:14:00+03:00', '2026-11-15T07:14:05-05:30', '2026-01-01T00:00:00+00:00', '2028-02-29T23:59:59+14:00']) {
    const clock = clockAt(stamp);
    assert.equal(localStamp(clock), stamp);
    assert.equal(instantOf(localStamp(clock)), clock.now());
  }
  assert.equal(instantOf('2026-11-15T07:14:00+03:00'), instantOf('2026-11-15T04:14:00Z'));
  assert.ok(instantOf('2026-11-15T07:14:00+03:00') > instantOf('2026-11-15T07:13:59+03:00'));
  assert.ok(Number.isNaN(instantOf('2026-11-15 07:14')));
  assert.ok(Number.isNaN(instantOf('2026-11-31T07:14:00+03:00')));
  assert.ok(isStamp('2026-11-15T07:14+03:00'));
  assert.ok(!isStamp('2026-11-15T24:00:00+03:00'));
});

test('stamps and days are written out for people', () => {
  assert.equal(stampText('2026-11-15T07:20:44+03:00'), '2026-11-15 07:20');
  assert.equal(stampDay('2026-11-15T07:20:44+03:00'), '2026-11-15');
  assert.equal(longDate('2026-11-15'), '15 November 2026');
  assert.equal(longDate('2027-01-01'), '1 January 2027');
  assert.equal(longDate('nonsense'), '');
});
