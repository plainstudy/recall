import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { REPO } from '../precache-list.mjs';

const TEXT = 4.5; // text
const MARK = 3; // marks, borders and the focus ring

// The stylesheet without its comments.
const readCss = async () =>
  (await readFile(new URL('styles.css', REPO), 'utf8')).replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\/\n?/g, '');

// The colour tokens declared in one block of the stylesheet: { '--ink': '#0B1826', ... }.
const tokensOf = (body) => Object.fromEntries([...body.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toUpperCase()]));

// The body of the first block with this selector, written exactly so, from a place on.
function blockOf(css, selector, from = 0) {
  const at = css.indexOf(`${selector} {`, from);
  assert.ok(at >= 0, `styles.css has no block for ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

// Night, from the first :root block; Day as the phone's light setting chooses it, and as
// Settings fixes it.
async function themes() {
  const css = await readCss();
  const media = css.indexOf('@media (prefers-color-scheme: light)');
  assert.ok(media >= 0, 'styles.css chooses Day by the phone setting');
  return {
    night: tokensOf(blockOf(css, ':root')),
    dayByPhone: tokensOf(blockOf(css, ':root:not([data-theme])', media)),
    dayFixed: tokensOf(blockOf(css, ":root[data-theme='day'],\n.figure-plate")),
  };
}

// WCAG's relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Every pair in the spec's contrast paragraph, for one theme: [foreground, background,
// threshold, what it is].
function pairsFor(theme) {
  const pairs = [];
  for (const bg of ['--ink', '--panel']) {
    for (const fg of ['--text', '--heading', '--muted', '--label']) pairs.push([fg, bg, TEXT, 'text']);
    pairs.push(['--focus', bg, MARK, 'the focus ring']);
    for (const state of ['--running', '--slowdown']) pairs.push([state, bg, TEXT, 'a state colour as text']);
    pairs.push(['--trip-text', bg, TEXT, 'red text']);
    // Night's red is for marks and borders only; red text takes --trip-text.
    pairs.push(theme === 'night' ? ['--trip', bg, MARK, 'red marks and borders'] : ['--trip', bg, TEXT, 'a state colour as text']);
  }
  pairs.push(['--on-accent', '--accent', TEXT, 'button text'], ['--on-accent', '--accent-press', TEXT, 'button text, pressed']);
  if (theme === 'day') {
    for (const [state, tint] of [
      ['--running', '--tint-running'],
      ['--slowdown', '--tint-slowdown'],
      ['--trip', '--tint-trip'],
      ['--trip-text', '--tint-trip'],
    ]) {
      pairs.push([state, tint, TEXT, 'a state colour on its tint']);
    }
    for (const tint of ['--tint-running', '--tint-slowdown', '--tint-trip']) pairs.push(['--text', tint, TEXT, 'text on a notice']);
  }
  return pairs;
}

test('acceptance test 42: every colour pair meets its threshold in both themes, read from styles.css', async () => {
  const { night, dayFixed } = await themes();
  const failures = [];
  for (const [name, tokens] of [
    ['night', night],
    ['day', dayFixed],
  ]) {
    for (const [fg, bg, threshold, what] of pairsFor(name)) {
      assert.ok(tokens[fg] && tokens[bg], `${name}: ${fg} or ${bg} is missing`);
      const ratio = contrast(tokens[fg], tokens[bg]);
      if (ratio < threshold) failures.push(`${name}: ${fg} on ${bg}, ${what}: ${ratio.toFixed(2)} < ${threshold}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('both themes hold the same tokens, and Day is written the same in both its places', async () => {
  const { night, dayByPhone, dayFixed } = await themes();
  assert.deepEqual(dayByPhone, dayFixed);
  assert.deepEqual(Object.keys(night).sort(), Object.keys(dayFixed).sort());
  // The spec's seventeen colours and the three tints behind markers and notices.
  assert.equal(Object.keys(night).length, 20);
});

test('the right, wrong and due colours keep their values, and brick is only the title line', async () => {
  const { night, dayFixed } = await themes();
  assert.deepEqual([night['--running'], night['--slowdown'], night['--trip'], night['--trip-text']], ['#3FB08C', '#E0A030', '#C0392B', '#E8604F']);
  assert.deepEqual([dayFixed['--running'], dayFixed['--slowdown'], dayFixed['--trip'], dayFixed['--trip-text']], ['#1D7A5C', '#8A5A00', '#B03224', '#B03224']);
  const css = await readCss();
  const uses = [...css.matchAll(/var\(--line\)/g)].map((m) => css.lastIndexOf('{', m.index)).map((open) => css.slice(css.lastIndexOf('}', open) + 1, open).trim());
  assert.deepEqual(uses, ['.screen-title::after']);
});

test("the page's theme colours and the manifest's are each theme's background", async () => {
  const { night, dayFixed } = await themes();
  const html = await readFile(new URL('index.html', REPO), 'utf8');
  const metas = Object.fromEntries(
    [...html.matchAll(/<meta name="theme-color" content="(#[0-9A-Fa-f]{6})" media="\(prefers-color-scheme: (dark|light)\)">/g)].map((m) => [m[2], m[1].toUpperCase()]),
  );
  assert.deepEqual(metas, { dark: night['--ink'], light: dayFixed['--ink'] });
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', REPO), 'utf8'));
  assert.equal(manifest.theme_color.toUpperCase(), night['--ink']);
  assert.equal(manifest.background_color.toUpperCase(), night['--ink']);
});
