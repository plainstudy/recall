import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PROGRESS_MESSAGES } from '../../engine/progress.js';
import { APP_NAME } from '../../ui/app-name.js';
import { chooseFile, firstRun, gotoPlace, install, readStored, watchErrors } from './helpers.js';

test('first run, Skip, then the bundle from Settings: its title shows, and lessons follow the track with the first current (test 32)', async ({ page }) => {
  const errors = watchErrors(page);
  await firstRun(page);
  await expect(page.locator('.app-title')).toHaveText(APP_NAME);
  await expect(page.locator('.learner')).toHaveText('Sam');
  await expect(page.locator('.home-notice')).toHaveText('Nothing installed yet. Import a bundle in Settings.');
  const fresh = await readStored(page);
  expect(fresh.progress.profile.name).toBe('Sam');
  expect(fresh.progress.settings).toEqual({ sessionSeconds: 660, theme: 'phone' });
  expect(fresh.progress.streak.freezesRemaining).toBe(2);
  expect(fresh.mirror).toEqual(fresh.progress);

  await gotoPlace(page, 'Settings');
  await chooseFile(page, 'Import', 'bundle-bakery.json');
  await expect(page.locator('.change-line').first()).toHaveText(
    'Bundle Bakery School 1.0: glossary 1.1, new, with 6 terms; pack Bread basics 1.0, new; track Baker 1.0, new.',
  );
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  // Back on Settings, where Import was started, with the line saying what was done.
  await expect(page.locator('.settings-screen .notice-done')).toHaveText('Bundle Bakery School 1.0 installed.');
  await expect(page.locator('.installed-name')).toHaveText(['Bundle Bakery School 1.0', 'Track Baker 1.0', 'Glossary 1.1', 'Pack Bread basics 1.0']);
  await gotoPlace(page, 'Home');
  await expect(page.locator('.app-title')).toHaveText('Bakery School');
  await gotoPlace(page, 'Library');
  await expect(page.locator('.lesson-title')).toHaveText(['Starting a dough', 'At the oven']);
  await expect(page.locator('.lesson').nth(0)).toHaveClass(/lesson-current/);
  await expect(page.locator('.lesson').nth(0).locator('.marker-current')).toHaveText('Current');
  await expect(page.locator('.lesson-current')).toHaveCount(1);

  const stored = await readStored(page);
  expect(Object.keys(stored.content).sort()).toEqual(['bundle', 'glossary', 'pack:bakery_basics', 'track']);
  expect(stored.progress.installed).toMatchObject({ bundleId: 'bakery', trackId: 'baker', glossaryVersion: '1.1', packs: { bakery_basics: '1.0' } });
  expect(stored.mirror).toEqual(stored.progress);

  // Everything stays after a restart.
  await page.reload();
  await expect(page.locator('.app-title')).toHaveText('Bakery School');
  await expect(page.locator('.learner')).toHaveText('Sam');
  await gotoPlace(page, 'Library');
  await expect(page.locator('.lesson')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('the name is required, trimmed, and at most 40 characters; Import your bundle goes straight to the picker', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#profile-name-problem')).toHaveText(PROGRESS_MESSAGES.nameMissing);
  await expect(page.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Your name').fill('x'.repeat(45));
  expect((await page.getByLabel('Your name').inputValue()).length).toBe(40);
  await page.getByLabel('Your name').fill('   Sam  ');
  await page.getByLabel('Your name').press('Enter');
  await expect(page.locator('.first-run-import')).toBeVisible();
  await install(page, 'bundle-bakery.json', { button: 'Import your bundle' });
  expect((await readStored(page)).progress.profile).toMatchObject({ name: 'Sam', role: 'Baker' });
});

test('acceptance test 41: first run asks only the name; the role reads Not set until a track gives it, and a different track replaces it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  await page.goto('/');
  await expect(page.locator('.first-run h1')).toHaveText(APP_NAME);
  await expect(page.locator('.first-run input')).toHaveCount(1);
  await expect(page.getByLabel('Your role')).toHaveCount(0);
  await page.getByLabel('Your name').fill('Sam');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  // Nothing to study yet: no large button, and the notice says why.
  await expect(page.locator('.home-notice')).toHaveText('Nothing installed yet. Import a bundle in Settings.');
  await expect(page.locator('.session-button')).toHaveCount(0);

  await gotoPlace(page, 'Settings');
  await expect(page.locator('.role-value')).toHaveText('Not set');
  expect((await readStored(page)).progress.profile.role).toBe('');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save report now', exact: true }).click()]);
  expect(await readFile(await download.path(), 'utf8')).toMatch(/^Learner: Sam · Role: not set · Track: none$/m);

  // The bundle's track gives the role.
  await install(page, 'bundle-bakery-next.json', { stay: true });
  await expect(page.locator('.role-value')).toHaveText('Baker');
  // A different track replaces it; this one has no role, so its title is used.
  await install(page, 'track-pastry.json', { stay: true });
  await expect(page.locator('.role-value')).toHaveText('Pastry cook');
  expect((await readStored(page)).progress.profile.role).toBe('Pastry cook');
  expect(errors).toEqual([]);
});
