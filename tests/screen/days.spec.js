import { expect, test } from '@playwright/test';
import { addDays, learnerDay } from '../../engine/days.js';
import { DAY_MS, cardsOf, done, expectControlsSized, expectStreak, firstRun, gotoPlace, install, pageClock, pinClock, playSession, readStored } from './helpers.js';

// Each test plays two or three whole sessions, so each gets more than the usual time.
test.describe.configure({ timeout: 90_000 });

const NOW = new Date('2026-11-16T09:00:00Z').getTime();
const PACKS = ['pack-bakery-next.json', 'pack-pastry.json'];

const button = (page) => page.locator('.session-button');
const lines = (page) => page.locator('.summary-line');

// A new learner who completes the first day's session. Returns that day.
async function dayOne(page, cards) {
  await pinClock(page, NOW);
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
  await button(page).click();
  await playSession(page, cards);
  await done(page);
  return learnerDay(await pageClock(page));
}

// The app coming back on screen, as when the phone is unlocked with it open.
const backOnScreen = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('the next day the reviews come up, mixed into the lesson, and the streak reaches 2', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  const first = await dayOne(page, cards);
  await expect(page.locator('.scorecard-due')).toHaveAttribute('aria-label', '0 reviews due today');

  await pinClock(page, NOW + DAY_MS);
  await page.reload();
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(button(page)).toHaveText("Start today's session");
  await expect(page.locator('.scorecard-due')).toHaveAttribute('aria-label', '8 reviews due today');
  await expectStreak(page, 1, 1, 2);

  await button(page).click();
  const played = await playSession(page, cards);
  const reviews = played.filter((id) => id.startsWith('bk_l01'));
  const fresh = played.filter((id) => id.startsWith('bk_l02'));
  expect(reviews.length).toBe(8);
  expect(fresh).toEqual(['c01', 'c02', 'c03', 'c04', 'c05', 'c07'].map((c) => `bk_l02_${c}`));
  expect(played.length).toBe(14);
  // Never between the teach card and its test, and the lesson's desk card is last.
  expect(played[played.indexOf('bk_l02_c01') + 1]).toBe('bk_l02_c02');
  expect(played[played.length - 1]).toBe('bk_l02_c07');
  await expect(lines(page)).toHaveText([
    '14 cards seen.',
    '13 of 13 answers correct, 100%.',
    '8 reviews moved up a box.',
    '2 of 2 traps cleared.',
    'Streak 2, longest 2, freezes left 2.',
    'The next review is due tomorrow.',
  ]);
  // The one moment: a mark for each review that moved up, right under its line, each
  // shifting up once; with reduced motion asked for, they hold still.
  const marks = page.locator('.summary-line:nth-child(3) + .moved-up .moved-up-mark');
  await expect(marks).toHaveCount(8);
  const motion = () => marks.first().evaluate((node) => [getComputedStyle(node).animationName, getComputedStyle(node).animationIterationCount]);
  expect(await motion()).toEqual(['none', '1']);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await motion()).toEqual(['moved-up', '1']);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const { progress } = await readStored(page);
  const second = addDays(first, 1);
  expect([progress.streak.current, progress.streak.longest, progress.streak.lastCountedDay]).toEqual([2, 2, second]);
  for (const id of reviews) {
    const atom = progress.atoms[cards.get(id).srsKey];
    expect([atom.box, atom.dueOn, atom.lastPromotedOn]).toEqual([2, addDays(second, 3), second]);
  }
  expect(progress.sessionLog[1].reviewCards).toBe(8);
  expect(progress.sessionLog[1].newCards).toBe(6);
});

test('a missed day uses a freeze when the app comes back on screen; with none left, the streak resets', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  const first = await dayOne(page, cards);
  await expectStreak(page, 1, 1, 2);

  // Two days later, the app still open: the day between was missed.
  await pinClock(page, NOW + 2 * DAY_MS);
  await backOnScreen(page);
  await expectStreak(page, 1, 1, 1);
  await expect(page.locator('.scorecard-due')).toHaveAttribute('aria-label', '8 reviews due today');
  let { progress, mirror } = await readStored(page);
  expect(progress.streak.freezesUsedOn).toEqual([addDays(first, 1)]);
  expect(progress.streak.checkedThrough).toBe(addDays(first, 1));
  expect(mirror).toEqual(progress);
  // Coming back again the same day checks nothing twice.
  await backOnScreen(page);
  await expectStreak(page, 1, 1, 1);
  expect((await readStored(page)).progress.streak).toEqual(progress.streak);

  await button(page).click();
  await playSession(page, cards);
  await expect(lines(page).nth(4)).toHaveText('Streak 2, longest 2, freezes left 1.');
  await done(page);

  // Three more days pass: the first uses the last freeze, the second resets the streak.
  await pinClock(page, NOW + 5 * DAY_MS);
  await page.reload();
  await expectStreak(page, 0, 2, 0);
  ({ progress } = await readStored(page));
  expect(progress.streak.freezesUsedOn).toEqual([addDays(first, 1), addDays(first, 3)]);
  await button(page).click();
  await playSession(page, cards);
  await expect(lines(page).nth(4)).toHaveText('Streak 1, longest 2, freezes left 0.');
});

test('a week on, the summary offers the weekly report once, and saving it takes the line away', async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  const cards = await cardsOf(...PACKS);
  await dayOne(page, cards);
  await expect(page.locator('.summary-report')).toHaveCount(0);

  await pinClock(page, NOW + 7 * DAY_MS);
  await page.reload();
  await button(page).click();
  await playSession(page, cards);
  await expect(page.locator('.report-due')).toHaveText('Your weekly report is due.');
  await expectControlsSized(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save report now', exact: true }).click()]);
  await expect(page.locator('.summary-screen .notice')).toHaveText(`Report downloaded: ${download.suggestedFilename()}.`);
  await expect(page.locator('.summary-report')).toHaveCount(0);
  await expect(lines(page).nth(0)).toHaveText(/^\d+ cards seen\.$/);
  expect((await readStored(page)).progress.reportsSavedOn.length).toBe(1);
  await done(page);
});
