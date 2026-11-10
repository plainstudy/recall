// Shared steps for the screen tests: opening fixtures, answering each card type right or
// wrong by its content, and measuring a card's layout.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { readPack } from '../../engine/cards.js';
import { plainText } from '../../engine/text.js';
import { seededReport } from './seed.js';

export const fixturePath = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

// The pack as the engine reads it, so the tests follow the same lesson and card order.
export async function readFixturePack(name) {
  const read = readPack(JSON.parse(await readFile(fixturePath(name), 'utf8')));
  if (!read.ok) throw new Error(read.message);
  return read.pack;
}

// Software that sits between a test server and the browser can rewrite a page's
// Content-Security-Policy, and Chromium then logs these two parse warnings. The app's own
// policy has no child-src, so they never come from the app; every other error counts.
const POLICY_REWRITE = [
  /directive 'form-action' contains 'child-src' as a source expression/,
  /directive 'form-action' contains the keyword 'none' alongside/,
];

export function watchErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (POLICY_REWRITE.some((re) => re.test(message.text()))) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

// First run: the name, then Skip (or stop at the bundle question).
export async function firstRun(page, { name = 'Sam', skip = true } = {}) {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.first-run-import')).toBeVisible();
  if (skip) {
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.locator('.home-screen')).toBeVisible();
  }
}

const PLACE_SCREENS = { Home: '.home-screen', Library: '.library-screen', Glossary: '.glossary-screen', Settings: '.settings-screen' };

// One of the four places, through the navigation bar; nothing to do if it is on screen.
export async function gotoPlace(page, place) {
  const screen = page.locator(PLACE_SCREENS[place]);
  if ((await screen.count()) === 0) {
    await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: place, exact: true }).click();
  }
  await expect(screen).toBeVisible();
}

// Taps a button that opens the file picker, and picks these files: fixture names, paths,
// or { name, mimeType, buffer }. Import is in Settings, so from another place it goes there
// first.
export async function chooseFile(page, buttonName, file) {
  if (buttonName === 'Import' && (await page.locator('.home-screen, .library-screen, .glossary-screen').count()) > 0) await gotoPlace(page, 'Settings');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: buttonName, exact: true }).click(),
  ]);
  await chooser.setFiles(typeof file === 'string' && !file.includes('/') && !file.includes('\\') ? fixturePath(file) : file);
}

// Imports a file from Settings, or from first run's own button, and installs it; then,
// unless `stay`, goes Home.
export async function install(page, file, { button = 'Import', confirm = 'Install', stay = false } = {}) {
  if (button === 'Import') await gotoPlace(page, 'Settings');
  await chooseFile(page, button, file);
  await expect(page.locator('.import-confirm')).toBeVisible();
  await page.getByRole('button', { name: confirm, exact: true }).click();
  await expect(page.locator('.settings-screen, .home-screen')).toBeVisible();
  if (!stay) await gotoPlace(page, 'Home');
}

// A learner with these files installed, on the start screen.
export async function setUp(page, files = ['glossary.json', 'pack-bakery.json']) {
  await firstRun(page);
  for (const file of files) await install(page, file);
}

// What the phone holds: the stored progress and content, and the mirror. Read without
// creating anything: a database that isn't there stays absent.
export function readStored(page) {
  return page.evaluate(async () => {
    const scope = new URL('./', location.href).href;
    const mirrorText = localStorage.getItem(`progress@${scope}`);
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes(`data@${scope}`)) return { exists: false, progress: null, session: null, content: {}, mirror: mirrorText && JSON.parse(mirrorText) };
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(`data@${scope}`);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const read = (store, how) =>
      new Promise((resolve, reject) => {
        const request = how(db.transaction(store).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const progress = (await read('progress', (s) => s.get('progress'))) || null;
    const session = (await read('session', (s) => s.get('session'))) || null;
    const keys = await read('content', (s) => s.getAllKeys());
    const values = await read('content', (s) => s.getAll());
    db.close();
    return {
      exists: true,
      progress,
      session,
      content: Object.fromEntries(keys.map((k, i) => [k, values[i]])),
      mirror: mirrorText && JSON.parse(mirrorText),
    };
  });
}

// Puts a progress object on the phone as an app would have left it: in the database and,
// unless `mirror` is false, in the mirror. The page must be reloaded to read it.
export function writeStored(page, progress, { mirror = true } = {}) {
  return page.evaluate(
    async ({ progress, mirror }) => {
      const scope = new URL('./', location.href).href;
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open(`data@${scope}`);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('progress', 'readwrite');
        tx.objectStore('progress').put(progress, 'progress');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      if (mirror) localStorage.setItem(`progress@${scope}`, JSON.stringify(progress));
      else localStorage.removeItem(`progress@${scope}`);
    },
    { progress, mirror },
  );
}

// The browser's clock, held at one moment so that no test depends on the real date. The
// default is midday UTC on the day the seeded reports are made, just after their time.
export const SEED_NOW = '2026-11-15T12:00:00Z';
export const DAY_MS = 86_400_000;

export async function pinClock(page, time = SEED_NOW) {
  await page.clock.setFixedTime(new Date(time));
}

// The phone's time read back from the page, as a clock the engine's day functions take.
export async function pageClock(page) {
  const { now, offset } = await page.evaluate(() => ({ now: Date.now(), offset: -new Date().getTimezoneOffset() }));
  return { now: () => now, offsetMinutes: () => offset };
}

let seeds = 0;

// Restores a report seeded for the test, generated as it runs, from Settings, then goes
// Home. Returns the seed.
export async function restoreSeed(page, testInfo, options = {}) {
  const seed = await seededReport(testInfo.outputPath(`seed-${++seeds}.md`), options);
  await gotoPlace(page, 'Settings');
  await chooseFile(page, 'Import', seed.path);
  await expect(page.locator('.import-confirm')).toHaveAttribute('data-kind', 'report');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('.settings-screen')).toBeVisible();
  await gotoPlace(page, 'Home');
  return seed;
}

const BOTH_COMPLETED = { currentLesson: null, currentCardIndex: 0, lessonsCompleted: ['bk_l01', 'bk_l02'], catchingUp: false };

// A learner with these files installed and both lessons of the bakery pack completed, by a
// seeded report, so that either can be played through Redo. The clock is pinned.
export async function setUpCompleted(page, testInfo, files = ['glossary.json', 'pack-bakery.json']) {
  await pinClock(page);
  await setUp(page, files);
  return restoreSeed(page, testInfo, { progress: (p) => ({ ...p, position: BOTH_COMPLETED }) });
}

// Starts the redo of a completed lesson from the Library, by its number in the list.
export async function redoLesson(page, number) {
  await gotoPlace(page, 'Library');
  await page.getByRole('button', { name: `Redo lesson ${number}`, exact: true }).click();
  await expect(page.locator('.card-screen')).toBeVisible();
}

// From a summary, back where the session was started: Home, or the Library for a redo.
export async function done(page) {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.home-screen, .library-screen')).toBeVisible();
}

// End session, from the menu at the end of the card row: its question shows.
export async function openEndQuestion(page) {
  await page.getByRole('button', { name: 'Session menu', exact: true }).click();
  await page.locator('.sheet').getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.end-question')).toBeVisible();
}

// Home's streak scorecards: the streak, the longest and the freezes left.
export async function expectStreak(page, current, longest, freezes) {
  await expect(page.locator('.scorecard-streak')).toHaveAttribute('data-value', String(current));
  await expect(page.locator('.scorecard-longest')).toHaveAttribute('data-value', String(longest));
  await expect(page.locator('.scorecard-freezes')).toHaveAttribute('data-value', String(freezes));
}

// On a place: the main action, if there is one, and the navigation bar in the lower third.
export async function expectFootInLowerThird(page) {
  const m = await page.evaluate(() => ({
    vh: window.innerHeight,
    nav: document.querySelector('.nav-bar').getBoundingClientRect().top,
    actions: [...document.querySelectorAll('.screen-foot .action-bar button')].map((b) => b.getBoundingClientRect().top),
  }));
  for (const top of [m.nav, ...m.actions]) expect(top).toBeGreaterThanOrEqual((m.vh * 2) / 3);
}

// Home's figures: { streak, longest, freezes, due }, as numbers.
export async function homeFigures(page) {
  await expect(page.locator('.home-screen')).toBeVisible();
  const read = async (kind) => Number(await page.locator(`.scorecard-${kind}`).getAttribute('data-value'));
  return { streak: await read('streak'), longest: await read('longest'), freezes: await read('freezes'), due: await read('due') };
}

export const expectedVerdict = (card, right) =>
  card.trap === true ? (right ? 'Trap cleared.' : 'Trap.') : right ? 'Correct.' : 'Incorrect.';

const named = (scope, text) => scope.getByRole('button', { name: plainText(text), exact: true });

// Answers the card on screen from its content: every right answer, or a wrong one.
export async function answer(page, card, how) {
  const screen = page.locator('.card-screen');
  const right = how === 'right';
  switch (card.type) {
    case 'mcq':
    case 'desk': {
      const option = card.options.find((o) => o.correct === right);
      await named(screen, option.text).click();
      return;
    }
    case 'cloze': {
      const chip = card.chips.find((c) => c.correct === right);
      await named(screen, chip.text).click();
      return;
    }
    case 'hotspot': {
      const region = card.regions.find((r) => r.correct === right);
      await screen.getByRole('button', { name: region.label, exact: true }).click();
      return;
    }
    case 'multi':
    case 'variant': {
      const chosen = right ? card.options.filter((o) => o.correct) : [card.options.find((o) => !o.correct)];
      for (const option of chosen) await named(screen, option.text).click();
      return;
    }
    case 'match': {
      const n = card.pairs.length;
      for (let i = 0; i < n; i++) {
        const partner = card.pairs[right ? i : (i + 1) % n];
        await named(screen, card.pairs[i].left).and(screen.locator('.match-left')).click();
        await named(screen, partner.right).and(screen.locator('.match-right')).click();
      }
      return;
    }
    case 'order': {
      const sorted = [...card.items].sort((a, b) => a.position - b.position);
      for (const item of right ? sorted : sorted.reverse()) await named(screen, item.text).click();
      return;
    }
    default:
      throw new Error(`no answer for ${card.type}`);
  }
}

// Plays the lesson on screen from its first card to its summary. onCard runs on each card
// before it is answered.
export async function playLesson(page, lesson, how, onCard) {
  await playCards(page, lesson.cards, how, onCard);
  await expect(page.locator('.summary-screen')).toBeVisible();
}

// Plays the card on screen through to Continue: a teach card is read, any other answered
// right or wrong and checked.
export async function playCard(page, card, how) {
  const screen = page.locator('.card-screen');
  const action = page.locator('.action-bar .primary');
  await expect(screen).toHaveAttribute('data-card-id', card.cardId);
  if (card.type === 'teach') {
    while ((await action.textContent()) === 'Show next') await action.click();
    await expect(action).toHaveText('Continue');
    await action.click();
    return;
  }
  await expect(action).toHaveText('Check');
  await expect(action).toBeDisabled();
  await answer(page, card, how);
  await expect(action).toBeEnabled();
  await action.click();
  await expect(screen.locator('.verdict')).toHaveText(expectedVerdict(card, how === 'right'));
  // The verdict is in view after Check, and not under the bar.
  const verdictShown = await page.evaluate(() => {
    const verdict = document.querySelector('.verdict').getBoundingClientRect();
    const bar = document.querySelector('.action-bar').getBoundingClientRect();
    return verdict.top >= 0 && verdict.bottom <= bar.top + 0.5;
  });
  expect(verdictShown).toBe(true);
  await expect(action).toHaveText('Continue');
  await action.click();
}

// Plays these cards in turn, starting from the one on screen.
export async function playCards(page, cards, how, onCard) {
  for (let i = 0; i < cards.length; i++) {
    await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', cards[i].cardId);
    if (onCard) await onCard(cards[i], i);
    await playCard(page, cards[i], how);
  }
}

// Every card of these packs, as the engine reads them, by card id.
export async function cardsOf(...fixtures) {
  const cards = new Map();
  for (const name of fixtures) {
    for (const lesson of (await readFixturePack(name)).lessons) for (const card of lesson.cards) cards.set(card.cardId, card);
  }
  return cards;
}

// Plays whatever comes on screen until the summary shows: the order of a session is not
// known ahead, and a card answered wrong comes back. `how` is 'right', 'wrong', or a
// function of the card and how many times it has been shown before, returning one of
// them. `upTo` stops early, after that many cards. Returns the ids of the cards played.
export async function playSession(page, cards, { how = 'right', onCard = null, upTo = Infinity } = {}) {
  const screen = page.locator('.card-screen');
  const played = [];
  while (played.length < upTo) {
    await expect(page.locator('.card-screen, .summary-screen')).toBeVisible();
    if ((await page.locator('.summary-screen').count()) > 0) break;
    const cardId = await screen.getAttribute('data-card-id');
    const card = cards.get(cardId);
    if (!card) throw new Error(`a card the fixtures do not hold: ${cardId}`);
    const before = played.filter((id) => id === cardId).length;
    if (onCard) await onCard(card, played.length, before);
    await playCard(page, card, typeof how === 'function' ? how(card, before) : how);
    played.push(cardId);
    // The next card, or the summary, takes this one's place.
    await page.waitForFunction((shown) => {
      const next = document.querySelector('.card-screen');
      return Boolean(document.querySelector('.summary-screen')) || (next && next.getAttribute('data-card-id') !== shown);
    }, cardId);
  }
  return played;
}

// The visible text of every answer control, which must be the content's text and nothing
// more: no letters or numbers added.
export async function expectNoLabels(page, card) {
  const texts = async (selector) => (await page.locator(selector).allTextContents()).map((t) => t.trim()).sort();
  const want = (list, field = 'text') => list.map((x) => plainText(x[field]).trim()).sort();
  switch (card.type) {
    case 'mcq':
    case 'desk':
    case 'multi':
    case 'variant':
      expect(await texts('.card-answers .option')).toEqual(want(card.options));
      break;
    case 'cloze':
      expect(await texts('.card-answers .chip')).toEqual(want(card.chips));
      break;
    case 'match':
      expect(await texts('.match-left')).toEqual(want(card.pairs, 'left'));
      expect(await texts('.match-right')).toEqual(want(card.pairs, 'right'));
      break;
    case 'order':
      expect(await texts('.card-answers .item')).toEqual(want(card.items));
      break;
    default:
      break;
  }
}

// Runs in the page. Scrolls to the bottom, where the bar sits in its own place, and
// measures every control in page coordinates.
function measure() {
  const doc = document.documentElement;
  window.scrollTo(0, doc.scrollHeight);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sy = window.scrollY;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + sy, bottom: r.bottom + sy, left: r.left, right: r.right, width: r.width, height: r.height, viewTop: r.top };
  };
  const shown = (el) => el.getBoundingClientRect().width > 0;
  const result = {
    vw,
    vh,
    scrollMax: doc.scrollHeight - vh,
    scrollWidth: doc.scrollWidth,
    answers: [...document.querySelectorAll('.card-answers button, .card-answers [role="button"]')].filter(shown).map(box),
    regions: [...document.querySelectorAll('.regions [role="button"]')].map(box),
    bar: [...document.querySelectorAll('.action-bar button')].map(box),
    wide: [...document.querySelectorAll('#app *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5);
      })
      .map((el) => el.getAttribute('class') || el.tagName),
  };
  window.scrollTo(0, 0);
  return result;
}

export const measureScreen = (page) => page.evaluate(measure);

const gapBetween = (a, b) => {
  const dx = Math.max(0, b.left - a.right, a.left - b.right);
  const dy = Math.max(0, b.top - a.bottom, a.top - b.bottom);
  return Math.hypot(dx, dy);
};

// The layout rules for a card screen, measured before it is answered:
//  - nothing wider than the screen;
//  - every control at least 48 by 48 px, and at least 8 px from every other;
//  - the bar's button in the lower third;
//  - the answers ending directly above the bar, so the nearest are under the thumb;
//  - with `allInLowerThird`, for a card short enough not to scroll, every control in the
//    lower third. Hotspot regions sit on their figure and are exempt from that rule.
export function expectCardLayout(m, { allInLowerThird = false } = {}) {
  expect(m.scrollWidth).toBeLessThanOrEqual(m.vw);
  expect(m.wide).toEqual([]);
  const controls = [...m.answers, ...m.regions, ...m.bar];
  for (const c of controls) {
    expect(c.width).toBeGreaterThanOrEqual(47.5);
    expect(c.height).toBeGreaterThanOrEqual(47.5);
  }
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      expect(gapBetween(controls[i], controls[j])).toBeGreaterThanOrEqual(7.5);
    }
  }
  const lowerThird = (m.vh * 2) / 3;
  for (const b of m.bar) expect(b.viewTop).toBeGreaterThanOrEqual(lowerThird);
  if (m.answers.length > 0) {
    const lowest = Math.max(...m.answers.map((a) => a.bottom));
    const barTop = Math.min(...m.bar.map((b) => b.top));
    expect(barTop - lowest).toBeLessThanOrEqual(24);
  }
  if (allInLowerThird) {
    expect(m.scrollMax).toBe(0);
    for (const a of m.answers) expect(a.top).toBeGreaterThanOrEqual(lowerThird);
  }
}

export function expectNothingWide(m) {
  expect(m.scrollWidth).toBeLessThanOrEqual(m.vw);
  expect(m.wide).toEqual([]);
}

// Runs in the page: every control on a screen other than a card, in page coordinates.
function measureControlsInPage() {
  const doc = document.documentElement;
  window.scrollTo(0, doc.scrollHeight);
  const vw = window.innerWidth;
  const sy = window.scrollY;
  const controls = [...document.querySelectorAll('#app button, #app input, #app [role="button"]')]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || el.id || '').trim().slice(0, 30), top: r.top + sy, bottom: r.bottom + sy, left: r.left, right: r.right, width: r.width, height: r.height };
    });
  const wide = [...document.querySelectorAll('#app *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5);
    })
    .map((el) => el.getAttribute('class') || el.tagName);
  window.scrollTo(0, 0);
  return { vw, scrollWidth: doc.scrollWidth, controls, wide };
}

// On every screen: nothing wider than the phone, and every control at least 48 px with
// 8 px to its neighbours. Placing them in the lower third is Session 4's.
export async function expectControlsSized(page) {
  const m = await page.evaluate(measureControlsInPage);
  expect(m.scrollWidth).toBeLessThanOrEqual(m.vw);
  expect(m.wide).toEqual([]);
  expect(m.controls.length).toBeGreaterThan(0);
  for (const c of m.controls) {
    expect(c.height, c.text).toBeGreaterThanOrEqual(47.5);
    expect(c.width, c.text).toBeGreaterThanOrEqual(47.5);
  }
  for (let i = 0; i < m.controls.length; i++) {
    for (let j = i + 1; j < m.controls.length; j++) {
      expect(gapBetween(m.controls[i], m.controls[j]), `${m.controls[i].text} / ${m.controls[j].text}`).toBeGreaterThanOrEqual(7.5);
    }
  }
}
