import { expect, test } from '@playwright/test';
import { chooseFile, firstRun, install, pinClock, readStored } from './helpers.js';
import { seededReport } from './seed.js';

// A phone with the bundle, and a learner restored from a report with atoms in it, on the
// day the report was made.
async function seededPhone(page, testInfo) {
  const seed = await seededReport(testInfo.outputPath('Bakery_School_Report_Sam-Baker_2026-11-15.md'));
  await pinClock(page);
  await firstRun(page, { name: 'Test', role: 'Test' });
  await install(page, 'bundle-bakery.json');
  await chooseFile(page, 'Import', seed.path);
  await expect(page.locator('.change-line')).toHaveText(["Restore Sam Baker's progress from 15 November 2026? This replaces the progress on this phone."]);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('.learner')).toHaveText('Sam Baker · Head baker');
  await expect(page.locator('.notice')).toHaveText("Sam Baker's progress is restored.");
  return seed;
}

test('a pack with a higher version keeps every atom’s box and due date (test 10)', async ({ page }, testInfo) => {
  const seed = await seededPhone(page, testInfo);
  const before = (await readStored(page)).progress;
  expect(before.atoms).toEqual(seed.progress.atoms);
  expect(Object.keys(before.atoms).length).toBe(4);

  await chooseFile(page, 'Import', 'pack-bakery-next.json');
  await expect(page.locator('.change-line')).toHaveText(['Pack Bread basics 1.0 → 1.1.', 'Your progress stays.']);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.locator('.notice')).toHaveText('Pack Bread basics 1.1 installed.');

  const after = await readStored(page);
  expect(after.progress.atoms).toEqual(before.atoms);
  for (const [key, atom] of Object.entries(before.atoms)) {
    expect([after.progress.atoms[key].box, after.progress.atoms[key].dueOn]).toEqual([atom.box, atom.dueOn]);
  }
  expect(after.progress.installed.packs).toEqual({ bakery_basics: '1.1' });
  expect(after.progress.position).toEqual(before.position);
  expect(after.mirror).toEqual(after.progress);
});

test('Remove keeps progress, and the same bundle brings the pack back where the learner was', async ({ page }, testInfo) => {
  await seededPhone(page, testInfo);
  const before = (await readStored(page)).progress;
  await expect(page.locator('.lesson-current .lesson-title')).toHaveText('At the oven');

  await page.getByRole('button', { name: 'Remove Bread basics', exact: true }).click();
  await expect(page.locator('.question-text')).toHaveText('Remove the pack Bread basics? Your progress stays, and importing the pack again brings it back.');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.notice').first()).toHaveText('Pack Bread basics removed. Your progress stays.');
  await expect(page.locator('.lesson')).toHaveCount(0);
  await expect(page.locator('.track-stop')).toHaveText("The next pack in your track isn't installed yet.");
  const removed = await readStored(page);
  expect(removed.content['pack:bakery_basics']).toBeUndefined();
  expect(removed.progress.atoms).toEqual(before.atoms);
  expect(removed.progress.streak).toEqual(before.streak);
  expect(removed.progress.position.lessonsCompleted).toEqual(['bk_l01']);

  await chooseFile(page, 'Import', 'bundle-bakery.json');
  await expect(page.locator('.change-line')).toHaveText([
    'Bundle Bakery School 1.0: glossary unchanged; pack Bread basics 1.0, new; track unchanged.',
    'Your progress stays.',
  ]);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.locator('.lesson')).toHaveCount(2);
  await expect(page.locator('.lesson-current .lesson-title')).toHaveText('At the oven');
  expect((await readStored(page)).progress.atoms).toEqual(before.atoms);
});
