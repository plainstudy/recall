// Random numbers for the engine. The caller supplies the raw source, a function that
// returns unsigned 32-bit integers, so the app can use the platform's cryptographic
// generator and tests can use a seeded one.

const RANGE = 0x100000000; // 2 ** 32

export function createRandom(nextUint32) {
  return {
    // An unbiased integer from 0 to n - 1, by rejection sampling: draws at or above the
    // largest multiple of n are thrown away, so no remainder is favoured.
    below(n) {
      if (!Number.isInteger(n) || n < 1 || n > RANGE) {
        throw new RangeError(`below(${n}): n must be an integer from 1 to 2^32`);
      }
      const limit = RANGE - (RANGE % n);
      for (;;) {
        const x = nextUint32() >>> 0;
        if (x < limit) return x % n;
      }
    },
  };
}

// Fisher-Yates: a uniformly random permutation of a copy of the list.
export function shuffle(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = random.below(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
