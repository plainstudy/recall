import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { APP_NAME, SHORT_NAME } from '../../ui/app-name.js';
import { REPO } from '../precache-list.mjs';

// The width and height a PNG file declares in its header.
const pngSize = (buf) => `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;

test('acceptance test 1, the files: the manifest and the page carry the names from ui/app-name.js', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', REPO), 'utf8'));
  assert.equal(manifest.name, APP_NAME);
  assert.equal(manifest.short_name, SHORT_NAME);
  assert.ok([...SHORT_NAME].length <= 12, 'the short name fits under an icon');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait');
  for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], './', key);
  const html = await readFile(new URL('index.html', REPO), 'utf8');
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)[1], APP_NAME);
});

test('each icon is a PNG of the size the manifest gives it', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', REPO), 'utf8'));
  for (const icon of manifest.icons) {
    const buf = await readFile(new URL(icon.src, REPO));
    assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', icon.src);
    assert.equal(pngSize(buf), icon.sizes, icon.src);
  }
});

// Every file of the app, tests included, apart from what Git ignores.
async function repoFiles(dir = REPO, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) await repoFiles(url, out);
    else out.push(url);
  }
  return out;
}

test("the app's name appears in its three files and nowhere else", async () => {
  const allowed = ['manifest.webmanifest', 'index.html', 'ui/app-name.js'];
  const found = [];
  for (const url of await repoFiles()) {
    const text = (await readFile(url)).toString('latin1');
    const path = url.href.slice(REPO.href.length);
    if (text.includes(APP_NAME) || text.includes(SHORT_NAME)) found.push(path);
  }
  assert.deepEqual(found.sort(), [...allowed].sort());
});
