// The streak (spec §6): each day on which a daily session is completed counts once; a
// missed day uses a freeze if one is left, and resets the streak when none is.
//
// Days are the learner's days, YYYY-MM-DD, worked out by the caller from the phone's time
// at each event, with the day starting at 04:00.

import { addDays, daysBetween } from './days.js';

export const MAX_FREEZES = 2;
export const COUNTED_DAYS_PER_FREEZE = 7;

// The missed-day check. Each day after the later of `lastCountedDay` and `checkedThrough`,
// up to yesterday, was missed: it uses a freeze and goes into `freezesUsedOn`, or, with
// none left, resets `current` to 0, after which further missed days change nothing more.
// `checkedThrough` then becomes yesterday, so no day is checked twice. Before the first
// counted day there is nothing to check. Returns the same object when nothing changes.
export function checkStreak(streak, today) {
  if (streak.lastCountedDay == null) return streak;
  const yesterday = addDays(today, -1);
  const from =
    streak.checkedThrough != null && daysBetween(streak.lastCountedDay, streak.checkedThrough) > 0 ? streak.checkedThrough : streak.lastCountedDay;
  if (daysBetween(from, yesterday) <= 0) return streak;

  let { current, freezesRemaining, countedRun } = streak;
  const freezesUsedOn = [...streak.freezesUsedOn];
  for (let day = addDays(from, 1); daysBetween(day, yesterday) >= 0; day = addDays(day, 1)) {
    countedRun = 0;
    if (freezesRemaining > 0) {
      // A day covered by a freeze leaves the streak as it was.
      freezesRemaining--;
      freezesUsedOn.push(day);
    } else {
      current = 0;
      break;
    }
  }
  return { ...streak, current, freezesRemaining, freezesUsedOn, countedRun, checkedThrough: yesterday };
}

// Counting today, after the check. A day counts once: a second session the same day, or a
// change of time zone that brings an earlier date back, adds nothing. Seven counted days
// in a row bring a freeze back, to two at most.
export function countDay(streak, today) {
  const checked = checkStreak(streak, today);
  if (checked.lastCountedDay != null && daysBetween(checked.lastCountedDay, today) <= 0) return checked;
  const current = checked.current + 1;
  let countedRun = checked.countedRun + 1;
  let freezesRemaining = checked.freezesRemaining;
  if (countedRun >= COUNTED_DAYS_PER_FREEZE) {
    if (freezesRemaining < MAX_FREEZES) freezesRemaining++;
    countedRun = 0;
  }
  return { ...checked, current, longest: Math.max(checked.longest, current), lastCountedDay: today, freezesRemaining, countedRun };
}
