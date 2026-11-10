import { expect, test } from '@playwright/test';
import { cardsOf, chooseFile, done, expectControlsSized, firstRun, install, pinClock, playSession, redoLesson } from './helpers.js';

test('every control on the Phase 3 screens is at least 48 px, with 8 px between controls', async ({ page }) => {
  test.setTimeout(90_000); // a whole session is played on the way
  const cards = await cardsOf('pack-bakery-next.json', 'pack-pastry.json');
  await pinClock(page, '2026-11-16T09:00:00Z');
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
  // The start screen: the session length, the large button, Import and the rest.
  await expect(page.locator('.length')).toHaveCount(4);
  await expectControlsSized(page);

  // A card in a session, with End session at the top: a teach card, then one with answers.
  await page.locator('.session-button').click();
  await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', 'bk_l01_c01');
  await expectControlsSized(page);
  await playSession(page, cards, { upTo: 1 });
  await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', 'bk_l01_c02');
  await expectControlsSized(page);

  // The End session question.
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.end-question')).toBeVisible();
  await expectControlsSized(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // The summary, then the start screen with a completed lesson and its Redo.
  await playSession(page, cards);
  await expect(page.locator('.summary-screen')).toBeVisible();
  await expectControlsSized(page);
  await done(page);
  await expect(page.getByRole('button', { name: 'Redo lesson 1', exact: true })).toBeVisible();
  await expectControlsSized(page);
  await redoLesson(page, 1);
  await expectControlsSized(page);
});

test('every control on the Phase 2 screens is at least 48 px, with 8 px between controls', async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  await page.goto('/');
  await expect(page.locator('.first-run')).toBeVisible();
  await expectControlsSized(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expectControlsSized(page); // with both field problems showing
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Your role').fill('Baker');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.first-run-import')).toBeVisible();
  await expectControlsSized(page);

  await chooseFile(page, 'Import your bundle', 'bundle-bakery.json');
  await expect(page.locator('.import-confirm')).toBeVisible();
  await expectControlsSized(page);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.locator('.start-screen')).toBeVisible();
  await install(page, 'pack-bakery-next.json');
  await expectControlsSized(page);

  await chooseFile(page, 'Import', 'pack-bakery-old.json');
  await expect(page.locator('.import-refused')).toBeVisible();
  await expectControlsSized(page);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Remove Bread basics', exact: true }).click();
  await expectControlsSized(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: 'Erase this phone', exact: true }).click();
  await expectControlsSized(page);
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expectControlsSized(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.start-screen')).toBeVisible();
});
