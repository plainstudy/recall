import { expect, test } from '@playwright/test';
import { done, gotoPlace, playCards, playLesson, readFixturePack, redoLesson, setUpCompleted } from './helpers.js';

const texts = (page, selector) => page.locator(selector).allTextContents();

// The lessons are completed by a seeded report, and played through Redo.
test('acceptance test 25: shown again, a card’s lists come in a new order, and the right option still scores', async ({ page }, testInfo) => {
  const pack = await readFixturePack('pack-bakery.json');
  const lesson = pack.lessons[0];
  const mcq = lesson.cards.find((c) => c.type === 'mcq');
  const match = lesson.cards.find((c) => c.type === 'match');
  expect(mcq.options.length).toBeGreaterThanOrEqual(3);
  expect(match.pairs.length).toBeGreaterThanOrEqual(3);

  const seen = {};
  const record = async (card) => {
    if (card.cardId === mcq.cardId) seen.options = await texts(page, '.card-answers .option');
    if (card.cardId === match.cardId) {
      seen.left = await texts(page, '.match-left');
      seen.right = await texts(page, '.match-right');
    }
  };

  await setUpCompleted(page, testInfo);
  await redoLesson(page, 1);
  await playLesson(page, lesson, 'right', record);
  const first = { ...seen };

  await done(page);
  await redoLesson(page, 1);
  await playLesson(page, lesson, 'right', record);
  expect(seen.options).not.toEqual(first.options);
  expect(seen.left).not.toEqual(first.left);
  expect(seen.right).not.toEqual(first.right);
  expect([...seen.options].sort()).toEqual([...first.options].sort());
});

test('acceptance test 25 across a reload: the first presentation after it differs from the last one before it', async ({ page }, testInfo) => {
  const pack = await readFixturePack('pack-bakery.json');
  const lesson = pack.lessons[0];
  const at = lesson.cards.findIndex((c) => c.type === 'mcq');
  const reachCard = async () => {
    await redoLesson(page, 1);
    await playCards(page, lesson.cards.slice(0, at), 'right');
    await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', lesson.cards[at].cardId);
    return texts(page, '.card-answers .option');
  };

  await setUpCompleted(page, testInfo);
  let last = await reachCard();
  for (let i = 0; i < 3; i++) {
    // A redo isn't stored: after a reload the app is back Home.
    await page.reload();
    await expect(page.locator('.home-screen')).toBeVisible();
    await gotoPlace(page, 'Library');
    await expect(page.locator('.lesson')).toHaveCount(2);
    const first = await reachCard();
    expect(first).not.toEqual(last);
    expect([...first].sort()).toEqual([...last].sort());
    last = first;
  }
});

test('acceptance test 14: a variant card hides its notes until Check, and scores all or nothing', async ({ page }, testInfo) => {
  const pack = await readFixturePack('pack-bakery.json');
  const lesson = pack.lessons[1];
  const at = lesson.cards.findIndex((c) => c.type === 'variant');
  const variant = lesson.cards[at];
  const correct = variant.options.filter((o) => o.correct);
  expect(correct.length).toBeGreaterThanOrEqual(2);
  const screen = page.locator('.card-screen');
  const notesShown = async () => {
    const body = await screen.textContent();
    return variant.options.filter((o) => body.includes(o.note)).length;
  };

  await setUpCompleted(page, testInfo);
  await redoLesson(page, 2);
  await playCards(page, lesson.cards.slice(0, at), 'right');
  await expect(screen).toHaveAttribute('data-card-id', variant.cardId);
  expect(await notesShown()).toBe(0);
  for (const option of correct) await screen.getByRole('button', { name: option.text, exact: true }).click();
  expect(await notesShown()).toBe(0);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(screen.locator('.verdict')).toHaveText('Trap cleared.');
  expect(await notesShown()).toBe(variant.options.length);
  await page.getByRole('button', { name: 'Continue' }).click();
  await playCards(page, lesson.cards.slice(at + 1), 'right');
  await expect(page.locator('.summary-screen')).toBeVisible();

  await done(page);
  await redoLesson(page, 2);
  await playCards(page, lesson.cards.slice(0, at), 'right');
  await expect(screen).toHaveAttribute('data-card-id', variant.cardId);
  await screen.getByRole('button', { name: correct[0].text, exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(screen.locator('.verdict')).toHaveText('Trap.');
  expect(await notesShown()).toBe(variant.options.length);
});
