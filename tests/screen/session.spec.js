import { expect, test } from '@playwright/test';
import { DAY_MS, answer, cardsOf, done, firstRun, install, pinClock, playSession, readStored, watchErrors } from './helpers.js';

// These tests play whole sessions card by card, so each gets more than the usual time.
test.describe.configure({ timeout: 90_000 });

const NOW = '2026-11-16T09:00:00Z';
const BUNDLE = 'bundle-bakery-next.json';
const PACKS = ['pack-bakery-next.json', 'pack-pastry.json'];

const button = (page) => page.locator('.session-button');
const lines = (page) => page.locator('.summary-line');
const states = (page) => page.locator('.lesson').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-state')));

// A new learner with the next bakery bundle, the clock held at one moment.
async function newLearner(page, now = NOW) {
  await pinClock(page, now);
  await firstRun(page);
  await install(page, BUNDLE);
}

async function start(page, label = "Start today's session") {
  await expect(button(page)).toHaveText(label);
  await button(page).click();
  await expect(page.locator('.card-screen')).toBeVisible();
}

test('a daily session from Start to the summary, then Start another session', async ({ page }) => {
  const errors = watchErrors(page);
  const cards = await cardsOf(...PACKS);
  await newLearner(page);
  await expect(page.locator('.streak-line')).toHaveText('Streak 0, longest 0, freezes left 2.');
  await expect(page.locator('.due-line')).toHaveText('No reviews due today.');
  await expect(page.locator('.place-line')).toHaveText('Lesson 1 of 4: Starting a dough');
  await expect(page.locator('.length[aria-pressed="true"]')).toHaveText('11 min');
  expect(await states(page)).toEqual(['current', 'locked', 'locked', 'locked']);

  await start(page);
  await expect(page.locator('.card-place')).toHaveText('Card 1 of 10');
  const first = await playSession(page, cards);
  expect(first).toEqual(['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c09', 'c07', 'c10', 'c08'].map((c) => `bk_l01_${c}`));
  await expect(page.locator('.summary-screen')).toHaveAttribute('data-kind', 'daily');
  await expect(lines(page)).toHaveText([
    '10 cards seen.',
    '8 of 8 answers correct, 100%.',
    'No atoms moved up a box.',
    'No traps.',
    'Streak 1, longest 1, freezes left 2.',
    'The next review is due tomorrow.',
  ]);

  // The session is stored as it ends: completed, the day counted, no record left over, and
  // the second copy of the progress brought up to date.
  let stored = await readStored(page);
  expect(stored.session).toBeNull();
  expect(stored.progress.streak.current).toBe(1);
  expect(stored.progress.sessionLog.map((s) => [s.kind, s.completed, s.newCards, s.answered, s.correct])).toEqual([['daily', true, 10, 8, 8]]);
  expect(stored.progress.position).toEqual({ currentLesson: 'bk_l02', currentCardIndex: 0, lessonsCompleted: ['bk_l01'], catchingUp: false });
  expect(Object.values(stored.progress.atoms).every((atom) => atom.box === 1 && atom.changedAt !== null)).toBe(true);
  expect(stored.mirror).toEqual(stored.progress);

  await done(page);
  await expect(page.locator('.streak-line')).toHaveText('Streak 1, longest 1, freezes left 2.');
  await expect(page.locator('.place-line')).toHaveText('Lesson 2 of 4: At the oven');
  expect(await states(page)).toEqual(['completed', 'current', 'locked', 'locked']);

  // After the day's session the button offers another one, which carries on with the lesson.
  await start(page, 'Start another session');
  const second = await playSession(page, cards);
  expect(second).toEqual(['c01', 'c02', 'c03', 'c04', 'c05', 'c07'].map((c) => `bk_l02_${c}`));
  await expect(lines(page)).toHaveText([
    '6 cards seen.',
    '5 of 5 answers correct, 100%.',
    'No atoms moved up a box.',
    '2 of 2 traps cleared.',
    'Streak 1, longest 1, freezes left 2.',
    'The next review is due tomorrow.',
  ]);
  stored = await readStored(page);
  expect(stored.progress.streak.current).toBe(1);
  expect(stored.progress.sessionLog.map((s) => s.completed)).toEqual([true, true]);
  expect(new Set(stored.progress.sessionLog.map((s) => s.id)).size).toBe(2);
  await done(page);
  expect(await states(page)).toEqual(['completed', 'completed', 'current', 'locked']);
  await expect(button(page)).toHaveText('Start another session');
  expect(errors).toEqual([]);
});

test('a completed 5-minute session counts for the streak (test 18)', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  await newLearner(page);
  await page.getByRole('button', { name: '5 min', exact: true }).click();
  await expect(page.locator('.length[aria-pressed="true"]')).toHaveText('5 min');
  expect((await readStored(page)).progress.settings.sessionSeconds).toBe(300);
  // The length is kept across a restart.
  await page.reload();
  await expect(page.locator('.length[aria-pressed="true"]')).toHaveText('5 min');

  await start(page);
  await playSession(page, cards);
  await expect(lines(page).nth(4)).toHaveText('Streak 1, longest 1, freezes left 2.');
  const { progress } = await readStored(page);
  expect([progress.sessionLog[0].lengthSec, progress.sessionLog[0].completed, progress.streak.current]).toEqual([300, true, 1]);
  expect(progress.streak.lastCountedDay).toBe(progress.sessionLog[0].day);
});

test('a card answered wrong comes back at least three cards later, with its options in a new order (test 26)', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  const missed = 'bk_l01_c02';
  expect(cards.get(missed).options.length).toBeGreaterThanOrEqual(3);
  await newLearner(page);
  await start(page);

  const orders = [];
  const played = await playSession(page, cards, {
    how: (card, before) => (card.cardId === missed && before === 0 ? 'wrong' : 'right'),
    onCard: async (card) => {
      if (card.cardId === missed) orders.push(await page.locator('.card-answers .option').allTextContents());
    },
  });
  const at = played.map((id, i) => (id === missed ? i : -1)).filter((i) => i >= 0);
  expect(at.length).toBe(2);
  expect(at[1] - at[0]).toBeGreaterThanOrEqual(3);
  expect(orders[1]).not.toEqual(orders[0]);
  expect([...orders[1]].sort()).toEqual([...orders[0]].sort());
  // Never between a teach card and its test, and the session still ends on its desk card.
  expect(played[played.indexOf('bk_l01_c03') + 1]).toBe('bk_l01_c04');
  expect(played[played.length - 1]).toBe('bk_l01_c08');
  expect(played.length).toBe(11);
  await expect(lines(page).nth(0)).toHaveText('11 cards seen.');
  await expect(lines(page).nth(1)).toHaveText('8 of 9 answers correct, 89%.');

  const { progress } = await readStored(page);
  const atom = progress.atoms['atom.ingredient.levain'];
  expect([atom.box, atom.totalSeen, atom.totalWrong, atom.lastMissedCardId]).toEqual([1, 2, 1, missed]);
  expect(progress.sessionLog[0].reAsks).toBe(1);
  expect(progress.confusions).toEqual([{ pair: ['levain', 'poolish'], count: 1, countAtLastContrast: 0, lastOn: progress.sessionLog[0].day }]);
});

test('End session asks first, keeps the answers, and Continue carries on at the same card with the same plan (test 39)', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  await newLearner(page);
  await start(page);
  await playSession(page, cards, { upTo: 3 });
  const screen = page.locator('.card-screen');
  await expect(screen).toHaveAttribute('data-card-id', 'bk_l01_c04');
  await expect(page.locator('.card-place')).toHaveText('Card 4 of 10');

  // The question is a screen of its own. Cancel puts the card back as it was left.
  await page.locator('.card-answers .chip').first().click();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.end-question .question-text p')).toHaveText([
    'End this session for now?',
    'Your answers are saved, and you can continue it today. The day counts once a session is finished.',
  ]);
  await expect(screen).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(screen).toHaveAttribute('data-card-id', 'bk_l01_c04');
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.locator('.end-question').getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.start-screen')).toBeVisible();
  await expect(button(page)).toHaveText("Continue today's session");
  await expect(page.locator('.streak-line')).toHaveText('Streak 0, longest 0, freezes left 2.');

  // The answers are saved, the day doesn't count, and the record waits.
  const left = await readStored(page);
  expect([left.session.index, left.session.plan.length, left.session.kind]).toEqual([3, 10, 'daily']);
  expect(left.session.passed.map((p) => p.cardId)).toEqual(['bk_l01_c01', 'bk_l01_c02', 'bk_l01_c03']);
  expect(left.session.passed[1].lists.options.length).toBe(3);
  expect([left.progress.streak.current, left.progress.sessionLog[0].completed, left.progress.sessionLog[0].answered]).toEqual([0, false, 1]);
  expect(Object.keys(left.progress.atoms)).toEqual(['atom.ingredient.levain']);
  expect(left.progress.position.currentCardIndex).toBe(3);
  expect(left.mirror).toEqual(left.progress);

  // Continue: the same card, the same plan, nothing assembled again.
  await button(page).click();
  await expect(screen).toHaveAttribute('data-card-id', 'bk_l01_c04');
  await expect(page.locator('.card-place')).toHaveText('Card 4 of 10');
  const rest = await playSession(page, cards);
  expect(rest).toEqual(left.session.plan.slice(3).map((item) => item.cardId));
  await expect(lines(page).nth(0)).toHaveText('10 cards seen.');
  await expect(lines(page).nth(4)).toHaveText('Streak 1, longest 1, freezes left 2.');
  const after = await readStored(page);
  expect(after.session).toBeNull();
  expect(after.progress.sessionLog.length).toBe(1);
  expect([after.progress.sessionLog[0].id, after.progress.sessionLog[0].completed]).toEqual([left.session.id, true]);
});

test('closing the app part-way keeps the session: after a restart, Continue carries on at the card it reached (test 39)', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  await newLearner(page);
  await start(page);
  await playSession(page, cards, { upTo: 4 });
  const screen = page.locator('.card-screen');
  await expect(screen).toHaveAttribute('data-card-id', 'bk_l01_c05');

  // Closed with a card on screen and not yet answered: it comes back.
  await page.reload();
  await expect(page.locator('.start-screen')).toBeVisible();
  await expect(button(page)).toHaveText("Continue today's session");
  await button(page).click();
  await expect(screen).toHaveAttribute('data-card-id', 'bk_l01_c05');
  await expect(page.locator('.card-place')).toHaveText('Card 5 of 10');

  // Closed after Check and before Continue: the answer was saved at Check, so the next
  // card is the one it reached.
  await answer(page, cards.get('bk_l01_c05'), 'right');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(screen.locator('.verdict')).toHaveText('Correct.');
  await expect.poll(async () => (await readStored(page)).session.index).toBe(5);
  await page.reload();
  await expect(button(page)).toHaveText("Continue today's session");
  await button(page).click();
  await expect(screen).toHaveAttribute('data-card-id', 'bk_l01_c06');
  await expect(page.locator('.card-place')).toHaveText('Card 6 of 10');

  await playSession(page, cards);
  await expect(lines(page).nth(1)).toHaveText('8 of 8 answers correct, 100%.');
  await expect(lines(page).nth(4)).toHaveText('Streak 1, longest 1, freezes left 2.');
  const { progress, session } = await readStored(page);
  expect(session).toBeNull();
  expect([progress.sessionLog.length, progress.sessionLog[0].answered, progress.sessionLog[0].completed]).toEqual([1, 8, true]);
});

test('an unfinished session is discarded the next day, and its answers stay (test 39)', async ({ page }) => {
  const cards = await cardsOf(...PACKS);
  await newLearner(page);
  await start(page);
  await playSession(page, cards, { upTo: 2 });
  await page.goBack(); // the phone's Back leaves the session as End session does
  await expect(button(page)).toHaveText("Continue today's session");
  expect((await readStored(page)).session.index).toBe(2);

  await pinClock(page, new Date(NOW).getTime() + DAY_MS);
  await page.reload();
  await expect(page.locator('.start-screen')).toBeVisible();
  await expect(button(page)).toHaveText("Start today's session");
  await expect(page.locator('.due-line')).toHaveText('1 review due today.');
  await expect(page.locator('.streak-line')).toHaveText('Streak 0, longest 0, freezes left 2.');
  const stored = await readStored(page);
  expect(stored.session).toBeNull();
  expect([stored.progress.sessionLog.length, stored.progress.sessionLog[0].completed, stored.progress.sessionLog[0].answered]).toEqual([1, false, 1]);
  expect(stored.progress.atoms['atom.ingredient.levain'].box).toBe(1);

  // The new day's session is assembled afresh, from where the lesson stopped.
  await button(page).click();
  const played = await playSession(page, cards);
  expect(played.filter((id) => id !== 'bk_l01_c02')[0]).toBe('bk_l01_c03');
  expect(played).toContain('bk_l01_c02');
  expect((await readStored(page)).progress.sessionLog.length).toBe(2);
});
