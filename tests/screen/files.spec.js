import { expect, test } from '@playwright/test';
import { FORMAT_MESSAGES } from '../../engine/formats.js';
import { MESSAGES } from '../../engine/validate.js';
import { chooseFile, firstRun, gotoPlace, install, pinClock, readFixturePack, readStored, redoLesson, restoreSeed, setUp, setUpCompleted, watchErrors } from './helpers.js';

const asFile = (name, data) => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });

// A refusal, then Close, back on Settings where Import was started.
async function expectRefused(page, message, more = 0) {
  await expect(page.locator('.import-refused')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page.locator('.refusal-more')).toHaveCount(more > 0 ? 1 : 0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.settings-screen')).toBeVisible();
}

test('a pack in the older shape is refused with the older-format message, and nothing changes', async ({ page }) => {
  const errors = watchErrors(page);
  await setUp(page, ['glossary.json']);
  const before = await readStored(page);
  await chooseFile(page, 'Import', 'pack-bakery-old.json');
  await expect(page.locator('.file-name')).toHaveText('pack-bakery-old.json');
  await expectRefused(page, MESSAGES.olderPack);
  await gotoPlace(page, 'Library');
  await expect(page.locator('.lesson')).toHaveCount(0);
  expect(await readStored(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('the lesson list leaves out unverified lessons and marks those that need review, once they are open', async ({ page }, testInfo) => {
  await pinClock(page);
  await setUp(page);
  await gotoPlace(page, 'Library');
  const lessons = page.locator('.lesson');
  await expect(lessons).toHaveCount(2);
  await expect(page.getByText('An unverified draft')).toHaveCount(0);
  await expect(lessons.nth(0).locator('.marker', { hasText: 'Needs review' })).toHaveCount(0);
  // For a new learner the second lesson is locked: its title and nothing else.
  await expect(lessons.nth(1)).toHaveAttribute('data-state', 'locked');
  await expect(lessons.nth(1).locator('.marker')).toHaveCount(0);
  // A learner who has reached it sees the marker.
  await restoreSeed(page, testInfo);
  await gotoPlace(page, 'Library');
  await expect(lessons.nth(1)).toHaveAttribute('data-state', 'current');
  await expect(lessons.nth(1).locator('.marker', { hasText: 'Needs review' })).toHaveCount(1);
  await expect(lessons.nth(0).locator('.marker', { hasText: 'Needs review' })).toHaveCount(0);
});

test('a file the app can’t import gets a plain message, never a blank screen', async ({ page }) => {
  await firstRun(page);
  await chooseFile(page, 'Import', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pack') });
  await expectRefused(page, FORMAT_MESSAGES.notImportable);
  await chooseFile(page, 'Import', asFile('empty.json', { lessons: [] }));
  await expectRefused(page, FORMAT_MESSAGES.notImportable);
  await chooseFile(page, 'Import', asFile('set.json', { testSetId: 'hard-cards' }));
  await expectRefused(page, FORMAT_MESSAGES.testSet);
  await chooseFile(page, 'Import', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32) });
  await expectRefused(page, FORMAT_MESSAGES.tooLarge);
  await chooseFile(page, 'Import', { name: 'report.md', mimeType: 'text/markdown', buffer: Buffer.from('# Bakery School — weekly report\n\nNo block.\n') });
  await expectRefused(page, FORMAT_MESSAGES.reportWithoutBlock);
  await expect(page.locator('.settings-installed')).toHaveText(/Nothing installed yet\./);
});

test('cards the engine can’t show are refused at import, with every problem counted', async ({ page }) => {
  const pack = {
    packId: 'odd_shapes',
    packVersion: '1.0',
    engineMin: '0.2.0',
    contentClass: 'public',
    order: 1,
    title: 'Odd shapes',
    lessons: [
      {
        lessonId: 'x1',
        order: 1,
        title: 'Odd shapes',
        verification: { status: 'verified' },
        cards: [
          { cardId: 'x1_c1', type: 'flashcard', prompt: 'A type the engine does not know.' },
          {
            cardId: 'x1_c2',
            type: 'hotspot',
            srsKey: 'atom.shape.spot',
            prompt: 'A hotspot without its figure.',
            figure: 'absent',
            regions: [
              { id: 'a', label: 'A', shape: { rect: [0, 0, 60, 60] }, correct: true },
              { id: 'b', label: 'B', shape: { rect: [80, 0, 60, 60] }, correct: false },
            ],
          },
        ],
      },
    ],
  };
  await firstRun(page);
  await chooseFile(page, 'Import', asFile('broken.json', pack));
  await expect(page.getByRole('alert')).toHaveText(`Card x1_c1: ${MESSAGES.unknownType('flashcard')}`);
  await expect(page.locator('.refusal-more')).toHaveText('There is 1 more problem.');
  await expectRefused(page, `Card x1_c1: ${MESSAGES.unknownType('flashcard')}`, 1);
  await expect(page.locator('.settings-installed')).toHaveText(/Nothing installed yet\./);
});

test('figures: stepped frames show one step at a time, and a missing figure is left out', async ({ page }, testInfo) => {
  const pack = await readFixturePack('pack-bakery.json');
  const stepped = pack.lessons[0].cards[2];
  expect(stepped.resolvedFigure.layers.length).toBe(3);
  await setUpCompleted(page, testInfo);
  await redoLesson(page, 1);
  const screen = page.locator('.card-screen');
  const action = page.locator('.action-bar .primary');
  await expect(screen.locator('.figure img')).toHaveCount(1);
  await expect(screen.locator('.figure img')).toHaveAttribute('alt', pack.lessons[0].cards[0].resolvedFigure.alt);
  await action.click();
  await page.locator('.card-answers .option').first().click();
  await action.click();
  await action.click();
  await expect(screen).toHaveAttribute('data-card-id', stepped.cardId);
  await expect(screen.locator('.figure img')).toHaveCount(1);
  await expect(action).toHaveText('Show next');
  await action.click();
  await expect(screen.locator('.figure img')).toHaveCount(2);
  await action.click();
  await expect(screen.locator('.figure img')).toHaveCount(3);
  await expect(action).toHaveText('Continue');

  // Back leaves the redo, to the Library it was started from.
  await page.goBack();
  await expect(page.locator('.library-screen')).toBeVisible();
  await redoLesson(page, 2);
  await expect(screen).toHaveAttribute('data-card-id', pack.lessons[1].cards[0].cardId);
  await expect(screen.locator('.prompt')).toBeVisible();
  await expect(screen.locator('.figure')).toHaveCount(0);
});

test('Back from a lesson returns to the Library, and Back from a place returns Home', async ({ page }, testInfo) => {
  await setUpCompleted(page, testInfo);
  await redoLesson(page, 2);
  await expect(page.locator('.card-screen')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.library-screen')).toBeVisible();
  await expect(page.locator('.lesson')).toHaveCount(2);
  await page.goBack();
  await expect(page.locator('.home-screen')).toBeVisible();
  // Import and Install come back to Settings, which says what was done.
  await install(page, 'track-bakery.json', { stay: true });
  await expect(page.locator('.notice-done')).toHaveText('Track Baker 1.0 installed.');
});
