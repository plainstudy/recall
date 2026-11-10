import { expect, test } from '@playwright/test';
import { isTestable } from '../../engine/scoring.js';
import { cardsOf, expectStreak, firstRun, gotoPlace, install, openEndQuestion, pinClock, playSession, readStored, watchErrors } from './helpers.js';

const NOW = '2026-11-16T09:00:00Z';
const PACKS = ['pack-bakery-next.json', 'pack-pastry.json'];

// The colour a square is filled with, and a token's value, both as rgb(...).
const fillOf = (locator) => locator.evaluate((node) => getComputedStyle(node).backgroundColor);
const tokenRgb = (page, token) =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, token);

async function startToday(page) {
  await pinClock(page, NOW);
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
  await page.locator('.session-button').click();
  await expect(page.locator('.card-screen')).toBeVisible();
}

test('acceptance test 35: the card row fills each square as its card is done, and a passed card opens read-only, as answered, with Previous, Next and Back', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const cards = await cardsOf(...PACKS);
  await startToday(page);
  const squares = page.locator('.card-row .square');
  const total = await squares.count();
  await expect(page.locator('.card-row')).toHaveAttribute('aria-label', `Card 1 of ${total}: 0 right, 0 wrong, 0 read`);
  await expect(squares.nth(0)).toHaveClass(/square-showing/);

  // Three cards: the first question answered wrong, everything else right.
  let wrongDone = false;
  const played = await playSession(page, cards, {
    upTo: 3,
    how: (card) => {
      if (!wrongDone && isTestable(card)) {
        wrongDone = true;
        return 'wrong';
      }
      return 'right';
    },
  });
  const wrongAt = played.findIndex((id) => isTestable(cards.get(id)));
  const states = played.map((id, i) => (!isTestable(cards.get(id)) ? 'read' : i === wrongAt ? 'wrong' : 'right'));
  for (let i = 0; i < 3; i++) await expect(squares.nth(i)).toHaveAttribute('data-state', states[i]);
  await expect(squares.nth(3)).toHaveAttribute('data-state', 'ahead');
  await expect(squares.nth(3)).toHaveClass(/square-showing/);
  // The colours are the right, wrong and read colours, unchanged.
  const colours = { right: await tokenRgb(page, '--running'), wrong: await tokenRgb(page, '--trip'), read: await tokenRgb(page, '--muted') };
  for (let i = 0; i < 3; i++) expect(await fillOf(squares.nth(i))).toBe(colours[states[i]]);
  expect(await squares.count()).toBeGreaterThan(total); // the wrong answer's re-ask has its own square
  const current = await page.locator('.card-screen').getAttribute('data-card-id');
  const before = await readStored(page);

  // A tap on the wrong card's square opens it read-only, as it was answered.
  await squares.nth(wrongAt).click();
  const review = page.locator('.card-review');
  await expect(review).toHaveAttribute('data-card-id', played[wrongAt]);
  await expect(review.locator('.looking-back')).toHaveText(`Card ${wrongAt + 1}, as it was answered`);
  await expect(review.locator('.verdict')).toHaveClass(/verdict-wrong/);
  await expect(review.locator('.mark-wrong')).not.toHaveCount(0);
  for (const control of await review.locator('.card-answers button').all()) await expect(control).toBeDisabled();
  // Its lists in the order they were shown: no new order is drawn.
  const shown = before.session.passed[wrongAt].lists;
  const card = cards.get(played[wrongAt]);
  if (shown.options) {
    const byId = new Map(card.options.map((o) => [String(o.id), o.text]));
    expect(await review.locator('.option-text').evaluateAll((nodes) => nodes.map((n) => n.firstChild.textContent))).toEqual(
      shown.options.map((id) => byId.get(id).replace(/`/g, '')),
    );
  }
  // The square keeps its colour, and the open card's square is marked.
  await expect(squares.nth(wrongAt)).toHaveAttribute('data-state', 'wrong');
  await expect(squares.nth(wrongAt)).toHaveClass(/square-showing/);

  // Previous and Next step through the cards passed; Back returns to the card left.
  const previous = page.getByRole('button', { name: 'Previous', exact: true });
  const next = page.getByRole('button', { name: 'Next', exact: true });
  for (let i = wrongAt; i > 0; i--) await previous.click();
  await expect(review).toHaveAttribute('data-card-id', played[0]);
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(review).toHaveAttribute('data-card-id', played[1]);
  await next.click();
  await expect(review).toHaveAttribute('data-card-id', played[2]);
  // From the last card passed, Next goes on to the card left.
  await next.click();
  await expect(page.locator('.card-review')).toHaveCount(0);
  await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', current);
  await squares.nth(wrongAt).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.card-review')).toHaveCount(0);
  await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', current);

  // A square not yet reached opens nothing.
  await squares.last().click();
  await expect(page.locator('.card-review')).toHaveCount(0);
  await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', current);
  // Looking back changed nothing.
  expect((await readStored(page)).progress).toEqual(before.progress);
  expect(errors).toEqual([]);
});

test('the session menu opens at the bottom of the screen: End session asks first, Cancel puts the card back, and the phone’s Back leaves without asking, saving the time on screen', async ({
  page,
}) => {
  const cards = await cardsOf(...PACKS);
  await page.clock.install({ time: new Date(NOW) });
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
  await page.locator('.session-button').click();
  await playSession(page, cards, { upTo: 2 });
  const current = await page.locator('.card-screen').getAttribute('data-card-id');

  // The menu: in the lower third, every control at least 48 px and 8 px apart.
  await page.getByRole('button', { name: 'Session menu', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Session menu' });
  await expect(sheet).toBeVisible();
  const boxes = await sheet.locator('button').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
  const vh = page.viewportSize().height;
  for (const b of boxes) {
    expect(b.height).toBeGreaterThanOrEqual(47.5);
    expect(b.top).toBeGreaterThanOrEqual((vh * 2) / 3);
  }
  expect(boxes[1].top - boxes[0].bottom).toBeGreaterThanOrEqual(7.5);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Session menu', exact: true }).click();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  // End session asks first; Cancel puts the card back as it was.
  await openEndQuestion(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.card-screen')).toHaveAttribute('data-card-id', current);

  // Thirty seconds more on this card, then the phone's Back: the session is left at once.
  await page.clock.fastForward(30_000);
  await page.goBack();
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(page.locator('.session-button')).toHaveText("Continue today's session");
  const stored = await readStored(page);
  expect(stored.session.index).toBe(2);
  expect(stored.session.elapsedSec).toBeGreaterThanOrEqual(30);
  const entry = stored.progress.sessionLog.find((e) => e.id === stored.session.id);
  expect(entry.durationSec).toBe(stored.session.elapsedSec);
  expect(stored.mirror).toEqual(stored.progress);
  await expectStreak(page, 0, 0, 2);
});

test('the navigation bar has four places, the current one marked, and is not shown during a session', async ({ page }) => {
  await pinClock(page, NOW);
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
  const nav = page.getByRole('navigation', { name: 'Places' });
  await expect(nav.getByRole('button')).toHaveText(['Home', 'Library', 'Glossary', 'Settings']);
  for (const place of ['Library', 'Glossary', 'Settings', 'Home']) {
    await gotoPlace(page, place);
    await expect(nav.locator('[aria-current="page"]')).toHaveText(place);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  }
  // Back from any place goes Home.
  await gotoPlace(page, 'Settings');
  await gotoPlace(page, 'Library');
  await page.goBack();
  await expect(page.locator('.home-screen')).toBeVisible();
  await page.locator('.session-button').click();
  await expect(page.locator('.card-screen')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Places' })).toHaveCount(0);
});
