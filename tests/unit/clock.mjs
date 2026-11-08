// A clock for unit tests, set to a written local time and its offset, and moved by hand.
import { instantOf } from '../../engine/days.js';

function read(stamp) {
  const m = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(stamp);
  const offset = !m || m[1] === 'Z' ? 0 : (m[2] === '-' ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4]));
  const now = instantOf(stamp);
  if (Number.isNaN(now)) throw new Error(`not a time: ${stamp}`);
  return { now, offset };
}

export function clockAt(stamp) {
  let { now, offset } = read(stamp);
  return {
    now: () => now,
    offsetMinutes: () => offset,
    // Moves to another written time, taking its offset too.
    set(next) {
      ({ now, offset } = read(next));
    },
    advance(ms) {
      now += ms;
    },
  };
}
