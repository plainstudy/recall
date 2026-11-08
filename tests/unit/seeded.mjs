// A small seeded generator of unsigned 32-bit integers (sfc32), so unit tests can
// replay the same random draws. Not used by the app.
import { createRandom } from '../../engine/random.js';

export function seededUint32(seed) {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}

export const seededRandom = (seed) => createRandom(seededUint32(seed));
