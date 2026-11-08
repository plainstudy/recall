import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

// The engine's logic modules must run in Node: no page, no storage, no network, and no
// time or randomness of their own. Both come in as arguments.
const FORBIDDEN =
  /\b(window|document|navigator|localStorage|sessionStorage|indexedDB|fetch|crypto|location|history|globalThis|self)\b|\bDate\.now\b|\bnew Date\b|\bMath\.random\b/;

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('engine modules use no browser globals, clock or randomness of their own', async () => {
  const dir = new URL('../../engine/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, 'the engine has modules');
  for (const file of files) {
    const code = withoutComments(await readFile(new URL(file, dir), 'utf8'));
    const hit = FORBIDDEN.exec(code);
    assert.equal(hit, null, `engine/${file} uses ${hit && hit[0]}`);
  }
});
