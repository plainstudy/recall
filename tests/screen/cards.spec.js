import { expect, test } from '@playwright/test';
import { isTestable } from '../../engine/scoring.js';
import { precacheList } from '../precache-list.mjs';
import {
  cardsOf,
  done,
  expectCardLayout,
  expectNoLabels,
  expectNothingWide,
  measureScreen,
  playCards,
  playLesson,
  playSession,
  readFixturePack,
  redoLesson,
  setUpCompleted,
  watchErrors,
} from './helpers.js';

const SHORT_CARD = 'bk_l01_c02'; // three short options: everything fits in the lower third

const trapsLine = (cleared, shown) => (shown === 0 ? 'No traps.' : `${cleared} of ${shown} ${shown === 1 ? 'trap' : 'traps'} cleared.`);

// Both lessons are completed by a seeded report, and each is played through Redo.
test('every card type renders and takes an answer, right and then wrong, within the layout rules', async ({ page, baseURL }, testInfo) => {
  // Four passes over the pack, the wrong ones about three times as long for their re-asks.
  test.setTimeout(120_000);
  const pack = await readFixturePack('pack-bakery.json');
  const cards = await cardsOf('pack-bakery.json');
  const types = new Set(pack.lessons.flatMap((l) => l.cards.map((c) => c.type)));
  expect(types.size).toBe(9);

  const errors = watchErrors(page);
  const origin = new URL(baseURL).origin;
  const requested = new Set();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && !url.pathname.endsWith('/sw.js')) requested.add(`.${url.pathname}`);
  });

  await setUpCompleted(page, testInfo);
  const lines = page.locator('.summary-line');
  for (const [i, lesson] of pack.lessons.entries()) {
    const testable = lesson.cards.filter(isTestable);
    const traps = testable.filter((c) => c.trap === true).length;

    await redoLesson(page, i + 1);
    await playLesson(page, lesson, 'right', async (card) => {
      expectCardLayout(await measureScreen(page), { allInLowerThird: card.cardId === SHORT_CARD });
      await expectNoLabels(page, card);
    });
    await expect(lines.nth(0)).toHaveText(`${lesson.cards.length} cards seen.`);
    await expect(lines.nth(1)).toHaveText(`${testable.length} of ${testable.length} answers correct, 100%.`);
    await expect(lines.nth(2)).toHaveText(trapsLine(traps, traps));
    await done(page);

    // Answered wrong, each card comes back, so the pass follows what is on screen.
    await redoLesson(page, i + 1);
    const played = await playSession(page, cards, { how: 'wrong', onCard: async () => expectNothingWide(await measureScreen(page)) });
    const answered = played.filter((id) => isTestable(cards.get(id))).length;
    expect(answered).toBeGreaterThan(testable.length);
    await expect(lines.nth(0)).toHaveText(`${played.length} cards seen.`);
    await expect(lines.nth(1)).toHaveText(`0 of ${answered} answers correct, 0%.`);
    await done(page);
  }

  expect(errors).toEqual([]);
  const listed = new Set(await precacheList());
  expect([...requested].filter((path) => !listed.has(path))).toEqual([]);
});

test('after a wrong answer to a trap card, the explanation is its trap feedback, then the card’s', async ({ page }, testInfo) => {
  const pack = await readFixturePack('pack-bakery.json');
  const lesson = pack.lessons[1];
  const at = lesson.cards.findIndex((c) => c.type === 'mcq' && c.trap === true);
  const trap = lesson.cards[at];
  const chosen = trap.options.find((o) => !o.correct);

  await setUpCompleted(page, testInfo);
  await redoLesson(page, 2);
  await playCards(page, lesson.cards.slice(0, at), 'right');
  const screen = page.locator('.card-screen');
  await expect(screen).toHaveAttribute('data-card-id', trap.cardId);
  await screen.getByRole('button', { name: chosen.text, exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(screen.locator('.verdict')).toHaveText('Trap.');
  expect(await screen.locator('.explanation').allTextContents()).toEqual([trap.trapFeedback, trap.feedback]);
});
