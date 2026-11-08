// Reads the service worker's precache list, so tests can check it against what the app
// actually loads.
import { readFile } from 'node:fs/promises';

export const REPO = new URL('../', import.meta.url);

export async function precacheList() {
  const source = await readFile(new URL('sw.js', REPO), 'utf8');
  const block = /const PAGE = \[([\s\S]*?)\];/.exec(source);
  if (!block) throw new Error('sw.js: the PAGE list was not found');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
