import { expect, test } from '@playwright/test';
import { isId } from '../../engine/ids.js';
import { asSchemaTwo } from '../unit/fixtures.mjs';
import { chooseFile, firstRun, gotoPlace, install, pinClock, readStored, watchErrors, writeStored } from './helpers.js';
import { seededReport } from './seed.js';

test('progress saved by an older app migrates on start with nothing lost, once, into both copies (test 38)', async ({ page }) => {
  const errors = watchErrors(page);
  await firstRun(page);
  await install(page, 'bundle-bakery.json');
  const older = asSchemaTwo((await readStored(page)).progress);
  expect(older.schemaVersion).toBe(2);
  expect('deviceId' in older || 'learnerId' in older.profile).toBe(false);

  for (const mirror of [true, false]) {
    await writeStored(page, older, { mirror });
    await page.reload();
    await expect(page.locator('.home-screen')).toBeVisible();
    await expect(page.locator('.learner')).toHaveText('Sam');
    await gotoPlace(page, 'Library');
    await expect(page.locator('.lesson')).toHaveCount(2);
    const stored = await readStored(page);
    expect(stored.progress.schemaVersion).toBe(3);
    expect(isId(stored.progress.deviceId)).toBe(true);
    expect(isId(stored.progress.profile.learnerId)).toBe(true);
    expect(stored.mirror).toEqual(stored.progress);
    expect(asSchemaTwo(stored.progress)).toEqual(older);

    // The ids are made once: the next start finds them and keeps them.
    await page.reload();
    await expect(page.locator('.home-screen')).toBeVisible();
    expect((await readStored(page)).progress).toEqual(stored.progress);
  }
  expect(errors).toEqual([]);
});

test('a report from an older app restores, taking a new learner id and keeping this phone’s own (test 38)', async ({ page }, testInfo) => {
  const seed = await seededReport(testInfo.outputPath('older.md'), { older: true });
  expect(seed.progress.schemaVersion).toBe(2);
  await pinClock(page);
  await firstRun(page, { name: 'Test' });
  await install(page, 'bundle-bakery.json');
  const phone = (await readStored(page)).progress;

  await chooseFile(page, 'Import', seed.path);
  await expect(page.locator('.import-confirm')).toHaveAttribute('data-kind', 'report');
  await expect(page.locator('.change-line').first()).toHaveText("Restore Sam Baker's progress from 15 November 2026? This replaces the progress on this phone.");
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('.settings-screen')).toBeVisible();
  await gotoPlace(page, 'Home');
  await expect(page.locator('.learner')).toHaveText('Sam Baker');
  await expect(page.locator('.current-title')).toHaveText('At the oven');

  const restored = (await readStored(page)).progress;
  expect(restored.schemaVersion).toBe(3);
  expect(restored.deviceId).toBe(phone.deviceId);
  expect(isId(restored.profile.learnerId)).toBe(true);
  expect(restored.profile.learnerId).not.toBe(phone.profile.learnerId);
  expect(restored.installed).toEqual(phone.installed);
  const back = asSchemaTwo(restored);
  expect(back.atoms).toEqual(seed.marked.atoms);
  expect(back.position).toEqual(seed.marked.position);
  expect(back.sessionLog).toEqual(seed.marked.sessionLog);
  expect(back.reportsSavedOn).toEqual(seed.marked.reportsSavedOn);
});
