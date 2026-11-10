import { expect, test } from '@playwright/test';
import { PROGRESS_MESSAGES } from '../../engine/progress.js';
import { chooseFile, firstRun, install, pinClock, readStored } from './helpers.js';
import { seededReport } from './seed.js';

const REPORT_NAME = /^Bakery_School_Report_Sam-Baker_\d{4}-\d{2}-\d{2}\.md$/;

// The browser offers no share sheet, so the report is downloaded.
const noShareSheet = () => {
  delete Navigator.prototype.share;
  delete Navigator.prototype.canShare;
};

async function restore(page, path) {
  await chooseFile(page, 'Import', path);
  await expect(page.locator('.import-confirm')).toHaveAttribute('data-kind', 'report');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('.start-screen')).toBeVisible();
}

test('a saved report restores a wiped browser exactly: streak, position, every atom’s box and due date (test 20)', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  await page.addInitScript(noShareSheet);
  // The clock is held a few hours after the seeded report's time, on the same day.
  await pinClock(page);
  const seed = await seededReport(testInfo.outputPath('seed.md'));
  await firstRun(page, { name: 'Test', role: 'Test' });
  await install(page, 'bundle-bakery.json');
  await restore(page, seed.path);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save report now', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(REPORT_NAME);
  await expect(page.locator('.notice')).toHaveText(`Report downloaded: ${download.suggestedFilename()}.`);
  const saved = (await readStored(page)).progress;
  // The restored report carries its own day among the report days; saving adds the day
  // in the new file's name, whatever the date is when the test runs.
  const savedDay = /_(\d{4}-\d{2}-\d{2})\.md$/.exec(download.suggestedFilename())[1];
  expect(saved.reportsSavedOn).toEqual([...new Set([...seed.marked.reportsSavedOn, savedDay])].sort());
  expect(saved.termRequests.every((r) => r.reportedOn !== null)).toBe(true);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);

  // A new browser profile: nothing stored at all.
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 800 } });
  const wiped = await context.newPage();
  await pinClock(wiped);
  await firstRun(wiped, { name: 'Test', role: 'Test' });
  await install(wiped, 'bundle-bakery.json');
  await restore(wiped, path);
  await expect(wiped.locator('.learner')).toHaveText('Sam Baker · Head baker');
  await expect(wiped.locator('.lesson-current .lesson-title')).toHaveText('At the oven');
  const restored = (await readStored(wiped)).progress;
  expect(restored.streak).toEqual(saved.streak);
  expect(restored.position).toEqual(saved.position);
  expect(restored.atoms).toEqual(saved.atoms);
  for (const [key, atom] of Object.entries(saved.atoms)) {
    expect([restored.atoms[key].box, restored.atoms[key].dueOn]).toEqual([atom.box, atom.dueOn]);
  }
  expect(restored.profile).toEqual(saved.profile);
  expect(restored.reportsSavedOn).toEqual(saved.reportsSavedOn);
  expect(restored.installed).toEqual(saved.installed);
  await context.close();
});

test('a share that goes ahead marks the report saved; a cancelled one changes nothing', async ({ page }) => {
  await page.addInitScript(() => {
    window.sharedFiles = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files }) => {
        if (window.cancelShare) throw new DOMException('Share cancelled', 'AbortError');
        window.sharedFiles.push(files[0].name);
      },
    });
  });
  await firstRun(page);
  await install(page, 'bundle-bakery.json');
  const before = (await readStored(page)).progress;

  await page.evaluate(() => (window.cancelShare = true));
  await page.getByRole('button', { name: 'Save report now', exact: true }).click();
  await expect(page.locator('.notice')).toHaveText('The report was not saved.');
  expect((await readStored(page)).progress).toEqual(before);

  await page.evaluate(() => (window.cancelShare = false));
  await page.getByRole('button', { name: 'Save report now', exact: true }).click();
  const shared = await page.evaluate(() => window.sharedFiles);
  expect(shared).toEqual([expect.stringMatching(/^Bakery_School_Report_Sam_\d{4}-\d{2}-\d{2}\.md$/)]);
  await expect(page.locator('.notice')).toHaveText(`Report shared: ${shared[0]}.`);
  expect((await readStored(page)).progress.reportsSavedOn.length).toBe(1);
});

test('restore warns when this phone’s own progress is newer and holds sessions; a newer app’s report is refused', async ({ page }, testInfo) => {
  const seed = await seededReport(testInfo.outputPath('seed.md'));
  const older = await seededReport(testInfo.outputPath('older.md'), { stamp: '2026-10-20T09:00:00+03:00' });
  const newer = await seededReport(testInfo.outputPath('newer.md'), { change: (text) => text.replace('"schemaVersion": 3', '"schemaVersion": 4') });
  await pinClock(page);
  await firstRun(page);
  await install(page, 'bundle-bakery.json');
  await restore(page, seed.path);

  await chooseFile(page, 'Import', older.path);
  await expect(page.locator('.change-line').nth(0)).toHaveText("Restore Sam Baker's progress from 20 October 2026? This replaces the progress on this phone.");
  await expect(page.locator('.change-line').nth(1)).toHaveText(/^The progress on this phone is newer, from \d{1,2} [A-Z][a-z]+ \d{4}\.$/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await chooseFile(page, 'Import', newer.path);
  await expect(page.getByRole('alert')).toHaveText(PROGRESS_MESSAGES.newerApp);
});
