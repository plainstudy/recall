import { expect, test } from '@playwright/test';
import { openLesson, openPack, playCards, playLesson, readFixturePack } from './helpers.js';

const texts = (page, selector) => page.locator(selector).allTextContents();

test('acceptance test 25: shown again, a card’s lists come in a new order, and the right option still scores', async ({
  page,
}) => {
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

  await openPack(page, 'pack-bakery.json');
  await openLesson(page, 1);
  await playLesson(page, lesson, 'right', record);
  const first = { ...seen };

  await page.getByRole('button', { name: 'Play again' }).click();
  await playLesson(page, lesson, 'right', record);
  expect(seen.options).not.toEqual(first.options);
  expect(seen.left).not.toEqual(first.left);
  expect(seen.right).not.toEqual(first.right);
  expect([...seen.options].sort()).toEqual([...first.options].sort());
});

test('acceptance test 14: a variant card hides its notes until Check, and scores all or nothing', async ({ page }) => {
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

  await openPack(page, 'pack-bakery.json');
  await openLesson(page, 2);
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

  await page.getByRole('button', { name: 'Play again' }).click();
  await playCards(page, lesson.cards.slice(0, at), 'right');
  await expect(screen).toHaveAttribute('data-card-id', variant.cardId);
  await screen.getByRole('button', { name: correct[0].text, exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(screen.locator('.verdict')).toHaveText('Trap.');
  expect(await notesShown()).toBe(variant.options.length);
});
