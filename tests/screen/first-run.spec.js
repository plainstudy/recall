import { expect, test } from '@playwright/test';
import { PROGRESS_MESSAGES } from '../../engine/progress.js';
import { APP_NAME } from '../../ui/app-name.js';
import { chooseFile, firstRun, install, readStored, watchErrors } from './helpers.js';

test('first run, Skip, then the bundle: its title shows, and lessons follow the track with the first current (test 32)', async ({ page }) => {
  const errors = watchErrors(page);
  await firstRun(page);
  await expect(page.locator('.app-title')).toHaveText(APP_NAME);
  await expect(page.locator('.learner')).toHaveText('Sam · Baker');
  await expect(page.getByText('Nothing installed yet.')).toBeVisible();
  const fresh = await readStored(page);
  expect(fresh.progress.profile.name).toBe('Sam');
  expect(fresh.progress.settings).toEqual({ sessionSeconds: 660, theme: 'phone' });
  expect(fresh.progress.streak.freezesRemaining).toBe(2);
  expect(fresh.mirror).toEqual(fresh.progress);

  await chooseFile(page, 'Import', 'bundle-bakery.json');
  await expect(page.locator('.change-line').first()).toHaveText(
    'Bundle Bakery School 1.0: glossary 1.1, new, with 6 terms; pack Bread basics 1.0, new; track Baker 1.0, new.',
  );
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.locator('.app-title')).toHaveText('Bakery School');
  await expect(page.locator('.notice')).toHaveText('Bundle Bakery School 1.0 installed.');
  await expect(page.locator('.lesson-title')).toHaveText(['Starting a dough', 'At the oven']);
  await expect(page.locator('.lesson').nth(0)).toHaveClass(/lesson-current/);
  await expect(page.locator('.lesson').nth(0).locator('.lesson-marker-current')).toHaveText('Current');
  await expect(page.locator('.lesson-current')).toHaveCount(1);
  await expect(page.locator('.installed-name')).toHaveText(['Bundle Bakery School 1.0', 'Track Baker 1.0', 'Glossary 1.1', 'Pack Bread basics 1.0']);

  const stored = await readStored(page);
  expect(Object.keys(stored.content).sort()).toEqual(['bundle', 'glossary', 'pack:bakery_basics', 'track']);
  expect(stored.progress.installed).toMatchObject({ bundleId: 'bakery', trackId: 'baker', glossaryVersion: '1.1', packs: { bakery_basics: '1.0' } });
  expect(stored.mirror).toEqual(stored.progress);

  // Everything stays after a restart.
  await page.reload();
  await expect(page.locator('.app-title')).toHaveText('Bakery School');
  await expect(page.locator('.lesson')).toHaveCount(2);
  await expect(page.locator('.learner')).toHaveText('Sam · Baker');
  expect(errors).toEqual([]);
});

test('name and role are both required, trimmed, and at most 40 characters', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#profile-name-problem')).toHaveText(PROGRESS_MESSAGES.nameMissing);
  await expect(page.locator('#profile-role-problem')).toHaveText(PROGRESS_MESSAGES.roleMissing);
  await expect(page.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Your name').fill('x'.repeat(45));
  expect((await page.getByLabel('Your name').inputValue()).length).toBe(40);
  await page.getByLabel('Your name').fill('   Sam  ');
  await page.getByLabel('Your role').fill('  ');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#profile-name-problem')).toHaveText('');
  await expect(page.locator('#profile-role-problem')).toHaveText(PROGRESS_MESSAGES.roleMissing);
  await page.getByLabel('Your role').fill(' Head baker ');
  await page.getByLabel('Your role').press('Enter');
  await expect(page.locator('.first-run-import')).toBeVisible();
  // Import your bundle goes straight to the picker.
  await install(page, 'bundle-bakery.json', { button: 'Import your bundle' });
  await expect(page.locator('.learner')).toHaveText('Sam · Head baker');
  expect((await readStored(page)).progress.profile).toMatchObject({ name: 'Sam', role: 'Head baker' });
});
