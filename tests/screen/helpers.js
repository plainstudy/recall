// Shared steps for the screen tests: opening fixtures, answering each card type right or
// wrong by its content, and measuring a card's layout.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { readPack } from '../../engine/cards.js';
import { plainText } from '../../engine/text.js';

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

export async function openPack(page, name) {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixturePath(name));
  await expect(page.locator('.lessons-screen')).toBeVisible();
}

export async function openLesson(page, number) {
  await page.getByRole('button', { name: new RegExp(`^Lesson ${number}(?!\\d)`) }).click();
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

// Plays these cards in turn, starting from the one on screen.
export async function playCards(page, cards, how, onCard) {
  const screen = page.locator('.card-screen');
  const action = page.locator('.action-bar .primary');
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    await expect(screen).toHaveAttribute('data-card-id', card.cardId);
    if (onCard) await onCard(card, i);
    if (card.type === 'teach') {
      while ((await action.textContent()) === 'Show next') await action.click();
      await expect(action).toHaveText('Continue');
      await action.click();
      continue;
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
