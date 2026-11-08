import { expect, test } from '@playwright/test';
import { isTestable, summaryLine, tally } from '../../engine/scoring.js';
import { precacheList } from '../precache-list.mjs';
import {
  expectCardLayout,
  expectNoLabels,
  expectNothingWide,
  measureScreen,
  openLesson,
  openPack,
  playCards,
  playLesson,
  readFixturePack,
  watchErrors,
} from './helpers.js';

const SHORT_CARD = 'bk_l01_c02'; // three short options: everything fits in the lower third

test('every card type renders and takes an answer, right and then wrong, within the layout rules', async ({
  page,
  baseURL,
}) => {
  const pack = await readFixturePack('pack-bakery.json');
  const types = new Set(pack.lessons.flatMap((l) => l.cards.map((c) => c.type)));
  expect(types.size).toBe(9);

  const errors = watchErrors(page);
  const origin = new URL(baseURL).origin;
  const requested = new Set();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && !url.pathname.endsWith('/sw.js')) requested.add(`.${url.pathname}`);
  });

  await openPack(page, 'pack-bakery.json');
  for (const [i, lesson] of pack.lessons.entries()) {
    const testable = lesson.cards.filter(isTestable);
    const results = (correct) => testable.map((c) => ({ trap: c.trap === true, correct }));

    await openLesson(page, i + 1);
    await playLesson(page, lesson, 'right', async (card) => {
      expectCardLayout(await measureScreen(page), { allInLowerThird: card.cardId === SHORT_CARD });
      await expectNoLabels(page, card);
    });
    await expect(page.locator('.summary-line')).toHaveText(summaryLine(tally(lesson.cards.length, results(true))));

    await page.getByRole('button', { name: 'Play again' }).click();
    await playLesson(page, lesson, 'wrong', async () => expectNothingWide(await measureScreen(page)));
    await expect(page.locator('.summary-line')).toHaveText(summaryLine(tally(lesson.cards.length, results(false))));

    await page.getByRole('button', { name: 'Lessons' }).click();
    await expect(page.locator('.lessons-screen')).toBeVisible();
  }

  expect(errors).toEqual([]);
  const listed = new Set(await precacheList());
  expect([...requested].filter((path) => !listed.has(path))).toEqual([]);
});

test('after a wrong answer to a trap card, the explanation is its trap feedback, then the card’s', async ({
  page,
}) => {
  const pack = await readFixturePack('pack-bakery.json');
  const lesson = pack.lessons[1];
  const at = lesson.cards.findIndex((c) => c.type === 'mcq' && c.trap === true);
  const trap = lesson.cards[at];
  const chosen = trap.options.find((o) => !o.correct);

  await openPack(page, 'pack-bakery.json');
  await openLesson(page, 2);
  await playCards(page, lesson.cards.slice(0, at), 'right');
  const screen = page.locator('.card-screen');
  await expect(screen).toHaveAttribute('data-card-id', trap.cardId);
  await screen.getByRole('button', { name: chosen.text, exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(screen.locator('.verdict')).toHaveText('Trap.');
  expect(await screen.locator('.explanation').allTextContents()).toEqual([trap.trapFeedback, trap.feedback]);
});
