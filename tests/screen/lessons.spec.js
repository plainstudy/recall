import { expect, test } from '@playwright/test';
import { cardsOf, done, firstRun, install, pinClock, playSession, readFixturePack, readStored, redoLesson } from './helpers.js';

// These tests play whole sessions card by card, so each gets more than the usual time.
test.describe.configure({ timeout: 90_000 });

const NOW = '2026-11-16T09:00:00Z';
const PACKS = ['pack-bakery-next.json', 'pack-pastry.json'];

const button = (page) => page.locator('.session-button');
const rows = (page) => page.locator('.lesson');
const states = (page) => rows(page).evaluateAll((list) => list.map((row) => row.getAttribute('data-state')));

async function newLearner(page) {
  await pinClock(page, NOW);
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
}

test('lessons open one at a time: the lesson after the current one can’t be opened, and a completed lesson offers Redo (test 28)', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  await newLearner(page);
  expect(await states(page)).toEqual(['current', 'locked', 'locked', 'locked']);
  await expect(page.locator('.lesson-title')).toHaveText(['Starting a dough', 'At the oven', 'Layers of butter', 'From the tin to the counter']);
  await expect(page.locator('.pack-heading')).toHaveText(['Bread basics', 'Pastry basics']);

  // No lesson is a control: the current one opens only through the daily session, and a
  // locked one shows its title and nothing else, though this one needs review.
  await expect(page.locator('.lesson button, .lesson [role="button"], button.lesson')).toHaveCount(0);
  await expect(rows(page).nth(0).locator('.lesson-marker')).toHaveText(['Current']);
  for (const n of [1, 2, 3]) await expect(rows(page).nth(n).locator('.lesson-marker')).toHaveCount(0);
  for (const n of [0, 1, 2, 3]) {
    await rows(page).nth(n).click();
    await rows(page).nth(n).locator('.lesson-title').click();
  }
  await expect(page.locator('.start-screen')).toBeVisible();
  await expect(page.locator('.card-screen')).toHaveCount(0);

  await button(page).click();
  await playSession(page, cards);
  await done(page);
  expect(await states(page)).toEqual(['completed', 'current', 'locked', 'locked']);
  await expect(rows(page).nth(0).locator('.lesson-marker')).toHaveText(['Completed']);
  await expect(rows(page).nth(1).locator('.lesson-marker')).toHaveText(['Current', 'Needs review']);
  await expect(page.getByRole('button', { name: /^Redo lesson/ })).toHaveCount(1);
  // Still nothing opens from the current lesson or a locked one.
  for (const n of [1, 2, 3]) await rows(page).nth(n).locator('.lesson-title').click();
  await expect(page.locator('.card-screen')).toHaveCount(0);
});

test('a redo replays every card in order, leaves the position and the streak alone, and its summary has no streak (tests 28, 29)', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  const lesson = (await readFixturePack('pack-bakery-next.json')).lessons[0];
  await newLearner(page);
  await button(page).click();
  await playSession(page, cards);
  await done(page);
  const before = (await readStored(page)).progress;

  await redoLesson(page, 1);
  await expect(page.locator('.card-place')).toHaveText('Card 1 of 10');
  const played = await playSession(page, cards);
  expect(played).toEqual(lesson.cards.map((card) => card.cardId));
  const summary = page.locator('.summary-screen');
  await expect(summary).toHaveAttribute('data-kind', 'redo');
  await expect(summary.locator('.card-place')).toHaveText('Redo finished');
  await expect(summary.locator('.lesson-heading')).toHaveText('Starting a dough');
  const text = await page.locator('.summary-line').allTextContents();
  expect(text.slice(0, 3)).toEqual(['10 cards seen.', '8 of 8 answers correct, 100%.', 'No traps.']);
  expect(text.filter((line) => /streak/i.test(line))).toEqual([]);
  expect(text.filter((line) => /moved up/.test(line))).toEqual([]);

  const after = await readStored(page);
  expect(after.progress.position).toEqual(before.position);
  expect(after.progress.streak).toEqual(before.streak);
  expect(after.progress.sessionLog.map((s) => [s.kind, s.completed, s.lengthSec])).toEqual([['daily', true, 660], ['redo', true, 0]]);
  // Nothing was promoted: every atom is where the daily session left it.
  for (const [key, atom] of Object.entries(before.atoms)) {
    expect([after.progress.atoms[key].box, after.progress.atoms[key].dueOn]).toEqual([atom.box, atom.dueOn]);
    expect(after.progress.atoms[key].totalSeen).toBe(atom.totalSeen + 1);
  }
  expect(after.session).toBeNull();
  expect(after.mirror).toEqual(after.progress);
  await done(page);
  await expect(page.locator('.streak-line')).toHaveText('Streak 1, longest 1, freezes left 2.');
});

test('a wrong answer in a redo comes back within it, and a redo beside an unfinished session leaves that session to continue', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  await newLearner(page);
  await button(page).click();
  await playSession(page, cards);
  await done(page);

  // An unfinished daily session, two cards in.
  await button(page).click();
  await playSession(page, cards, { upTo: 2 });
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.locator('.end-question').getByRole('button', { name: 'End session', exact: true }).click();
  await expect(button(page)).toHaveText("Continue today's session");
  const waiting = (await readStored(page)).session;
  expect(waiting.index).toBe(2);

  // A redo, with one card missed: it is asked again, at least three cards later.
  await redoLesson(page, 1);
  const played = await playSession(page, cards, { how: (card, seen) => (card.cardId === 'bk_l01_c04' && seen === 0 ? 'wrong' : 'right'), upTo: 8 });
  const at = played.indexOf('bk_l01_c04');
  expect(at).toBe(3);

  // Leaving a redo ends it; the question says so, and nothing of it is stored as a record.
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.end-question .question-text p')).toHaveText(['End this redo?', 'Your answers are saved.']);
  await page.locator('.end-question').getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.start-screen')).toBeVisible();
  const stored = await readStored(page);
  expect(stored.session).toEqual(waiting);
  expect(stored.progress.atoms['atom.ingredient.hydration'].lastMissedCardId).toBe('bk_l01_c04');
  expect(stored.progress.sessionLog.map((s) => [s.kind, s.completed])).toEqual([['daily', true], ['daily', false], ['redo', false]]);
  await expect(button(page)).toHaveText("Continue today's session");
  await button(page).click();
  await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', waiting.plan[2].cardId);
});
