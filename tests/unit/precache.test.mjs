import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REPO, precacheList } from '../precache-list.mjs';

// A repository path in the precache list's form: "./engine/cards.js".
const asEntry = (url) => `./${url.href.slice(REPO.href.length)}`;

const IMPORT_PATTERNS = [
  /\bimport\s[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bexport\s[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
];

// Every module reachable from a starting script, followed through relative imports.
async function moduleGraph(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const url = queue.shift();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const source = await readFile(url, 'utf8');
    for (const pattern of IMPORT_PATTERNS) {
      for (const m of source.matchAll(pattern)) queue.push(new URL(m[1], url));
    }
  }
  return [...seen].map((href) => new URL(href));
}

async function scriptsIn(dir) {
  const base = new URL(`${dir}/`, REPO);
  return (await readdir(base)).filter((f) => f.endsWith('.js')).map((f) => new URL(f, base));
}

// Everything the app loads: the page itself, what index.html links, the manifest's icons,
// the module graph from each script, and every script in engine/ and ui/.
async function filesTheAppLoads() {
  const loaded = new Set(['./', './index.html']);
  const html = await readFile(new URL('index.html', REPO), 'utf8');
  const scripts = [];
  for (const m of html.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
    const url = new URL(m[1], REPO);
    loaded.add(asEntry(url));
    if (url.pathname.endsWith('.js')) scripts.push(url);
  }
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', REPO), 'utf8'));
  for (const iconEntry of manifest.icons) loaded.add(asEntry(new URL(iconEntry.src, REPO)));
  for (const script of scripts) for (const url of await moduleGraph(script)) loaded.add(asEntry(url));
  for (const dir of ['engine', 'ui']) for (const url of await scriptsIn(dir)) loaded.add(asEntry(url));
  return loaded;
}

test('the precache list holds every file the app loads', async () => {
  const listed = new Set(await precacheList());
  const loaded = await filesTheAppLoads();
  assert.ok(loaded.has('./app.js') && loaded.has('./styles.css') && loaded.has('./ui/controller.js'));
  const missing = [...loaded].filter((path) => !listed.has(path));
  assert.deepEqual(missing, [], `missing from sw.js: ${missing.join(', ')}`);
});

test('every file in the precache list exists, so the install cannot fail on one', async () => {
  const listed = await precacheList();
  assert.equal(new Set(listed).size, listed.length, 'no duplicates');
  for (const path of listed) {
    if (path === './') continue;
    await assert.doesNotReject(access(fileURLToPath(new URL(path, REPO))), `${path} does not exist`);
  }
});
