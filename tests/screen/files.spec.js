import { expect, test } from '@playwright/test';
import { MESSAGES } from '../../engine/cards.js';
import { isTestable, summaryLine, tally } from '../../engine/scoring.js';
import { VIEWER_MESSAGES } from '../../ui/viewer.js';
import { fixturePath, openLesson, openPack, playLesson, readFixturePack, watchErrors } from './helpers.js';

test('a pack in the older shape opens and plays', async ({ page }) => {
  const errors = watchErrors(page);
  const pack = await readFixturePack('pack-bakery-old.json');
  const lesson = pack.lessons[0];
  await openPack(page, 'pack-bakery-old.json');
  await expect(page.getByRole('heading', { name: pack.title })).toBeVisible();
  await openLesson(page, 1);
  await playLesson(page, lesson, 'right');
  const results = lesson.cards.filter(isTestable).map(() => ({ trap: false, correct: true }));
  await expect(page.locator('.summary-line')).toHaveText(summaryLine(tally(lesson.cards.length, results)));
  expect(errors).toEqual([]);
});

test('the lesson list leaves out unverified lessons and marks those that need review', async ({ page }) => {
  await openPack(page, 'pack-bakery.json');
  const lessons = page.locator('.lesson');
  await expect(lessons).toHaveCount(2);
  await expect(page.getByText('An unverified draft')).toHaveCount(0);
  await expect(lessons.nth(0).locator('.lesson-marker')).toHaveCount(0);
  await expect(lessons.nth(1).locator('.lesson-marker')).toHaveText('Needs review');
});

test('a file that is not a pack gets a plain message, never a blank screen', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('input[type=file]');
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pack') });
  await expect(page.getByRole('alert')).toHaveText(VIEWER_MESSAGES.notJson);
  await expect(page.getByRole('button', { name: 'Open a pack file' })).toBeVisible();
  await input.setInputFiles(fixturePath('glossary.json'));
  await expect(page.getByRole('alert')).toHaveText(MESSAGES.glossary);
  await input.setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('{"lessons": []}') });
  await expect(page.getByRole('alert')).toHaveText(MESSAGES.noLessons);
});

test('a card that cannot be shown says so, and the lesson carries on', async ({ page }) => {
  const pack = {
    title: 'Broken cards',
    lessons: [
      {
        lessonId: 'x1',
        order: 1,
        title: 'Odd shapes',
        cards: [
          { cardId: 'x1_c1', type: 'flashcard', prompt: 'A type the engine does not know.' },
          {
            cardId: 'x1_c2',
            type: 'hotspot',
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
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
  await openLesson(page, 1);
  await expect(page.locator('.notice')).toHaveText(MESSAGES.unknownType);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.notice')).toHaveText(MESSAGES.figureMissing);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.summary-line')).toHaveText('2 cards, 0 answered, 0 correct, no traps.');
});

test('figures: stepped frames show one step at a time, and a missing figure is left out', async ({ page }) => {
  const pack = await readFixturePack('pack-bakery.json');
  const stepped = pack.lessons[0].cards[2];
  expect(stepped.resolvedFigure.layers.length).toBe(3);
  await openPack(page, 'pack-bakery.json');
  await openLesson(page, 1);
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

  await page.goBack();
  await expect(page.locator('.lessons-screen')).toBeVisible();
  await openLesson(page, 2);
  await expect(screen).toHaveAttribute('data-card-id', pack.lessons[1].cards[0].cardId);
  await expect(screen.locator('.prompt')).toBeVisible();
  await expect(screen.locator('.figure')).toHaveCount(0);
});

test('Back from a lesson returns to the lesson list', async ({ page }) => {
  await openPack(page, 'pack-bakery.json');
  await openLesson(page, 2);
  await expect(page.locator('.card-screen')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.lessons-screen')).toBeVisible();
  await expect(page.locator('.lesson')).toHaveCount(2);
});
