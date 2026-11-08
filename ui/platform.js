// The browser's sources of randomness and time, handed to the engine as arguments.
import { createRandom } from '../engine/random.js';

export function cryptoRandom() {
  const buffer = new Uint32Array(64);
  let next = buffer.length;
  return createRandom(() => {
    if (next === buffer.length) {
      crypto.getRandomValues(buffer);
      next = 0;
    }
    return buffer[next++];
  });
}

// The time now, and the phone's offset from UTC at a given moment, in minutes east.
export const systemClock = {
  now: () => Date.now(),
  offsetMinutes: (ms) => -new Date(ms).getTimezoneOffset(),
};
