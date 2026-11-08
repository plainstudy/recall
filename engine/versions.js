// Version numbers. The engine's is MAJOR.MINOR.PATCH; content files use MAJOR.MINOR.
// Versions compare part by part as numbers, so 1.10 is newer than 1.9, and a missing
// part counts as 0, so "1.1" means 1.1.0.

const VERSION = /^\d{1,6}(\.\d{1,6}){0,2}$/;
const CONTENT_VERSION = /^\d{1,6}\.\d{1,6}$/;

// Any version: one to three numbers separated by dots.
export const isVersion = (v) => typeof v === 'string' && VERSION.test(v);

// A content version: exactly MAJOR.MINOR.
export const isContentVersion = (v) => typeof v === 'string' && CONTENT_VERSION.test(v);

const parts = (v) => v.split('.').map(Number);

// -1 when a is older than b, 0 when they are the same, 1 when a is newer.
export function compareVersions(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// A version written out in full, MAJOR.MINOR.PATCH, for messages.
export function fullVersion(v) {
  const p = parts(v);
  while (p.length < 3) p.push(0);
  return p.join('.');
}
