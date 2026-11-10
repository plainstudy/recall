import { expect, test } from '@playwright/test';
import { CONTROLLER_MESSAGES } from '../../ui/controller.js';
import { firstRun, gotoPlace, install, readStored } from './helpers.js';

test('Erase offers a report first, asks to confirm, and leaves nothing of the learner behind', async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  await firstRun(page);
  await install(page, 'bundle-bakery.json');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cachesBefore = await page.evaluate(() => caches.keys());
  expect(cachesBefore.length).toBeGreaterThan(0);

  // Saving the offered report, then thinking better of it. Erase is in Settings.
  await gotoPlace(page, 'Settings');
  await page.getByRole('button', { name: 'Erase this phone', exact: true }).click();
  await expect(page.locator('.erase-offer .question-text')).toHaveText(CONTROLLER_MESSAGES.eraseOffer);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save report', exact: true }).click()]);
  await expect(page.locator('.erase-confirm .question-text p')).toHaveText([
    CONTROLLER_MESSAGES.reportDownloaded(download.suggestedFilename()),
    CONTROLLER_MESSAGES.eraseConfirm,
  ]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.settings-screen')).toBeVisible();

  // Skipping the report, and erasing.
  await page.getByRole('button', { name: 'Erase this phone', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.locator('.erase-confirm .question-text')).toHaveText(CONTROLLER_MESSAGES.eraseConfirm);
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  const left = await readStored(page);
  expect(left.exists).toBe(false);
  expect(left.mirror).toBeNull();
  expect(await page.evaluate(() => caches.keys())).toEqual(cachesBefore);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(1);

  // And the app starts again from nothing.
  await page.reload();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await firstRun(page, { name: 'Alex' });
  await expect(page.locator('.home-notice')).toHaveText('Nothing installed yet. Import a bundle in Settings.');
});
