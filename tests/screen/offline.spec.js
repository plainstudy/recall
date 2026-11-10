import { expect, test } from '@playwright/test';
import { cardsOf, done, firstRun, install, pinClock, playSession, readStored } from './helpers.js';

test('acceptance test 2: after one online load, a full session completes with the network off', async ({ page, context }) => {
  test.setTimeout(90_000); // a whole session is played
  const cards = await cardsOf('pack-bakery-next.json', 'pack-pastry.json');
  await pinClock(page, '2026-11-16T09:00:00Z');
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.home-screen')).toBeVisible();
  await page.locator('.session-button').click();
  const played = await playSession(page, cards);
  expect(played.length).toBeGreaterThan(5);
  await expect(page.locator('.summary-screen')).toBeVisible();
  await done(page);
  const { progress } = await readStored(page);
  expect(progress.sessionLog.map((s) => s.completed)).toEqual([true]);
  expect(progress.streak.current).toBe(1);
});
