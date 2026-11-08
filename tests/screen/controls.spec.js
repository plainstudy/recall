import { expect, test } from '@playwright/test';
import { chooseFile, expectControlsSized, install } from './helpers.js';

test('every control on the Phase 2 screens is at least 48 px, with 8 px between controls', async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  await page.goto('/');
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
