import { expect, test } from '@playwright/test';
import { firstRun, gotoPlace, install, pinClock, readStored } from './helpers.js';

const NIGHT = 'rgb(11, 24, 38)'; // the Night --ink
const DAY = 'rgb(244, 247, 246)'; // the Day --ink
const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const themeColours = (page) => page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));
const choice = (page) => page.locator('.choices-theme [aria-pressed="true"]');

test('acceptance test 36: the theme follows the phone’s light or dark setting by default, Settings fixes Night or Day, and a change mid-session applies at once', async ({ page }) => {
  await pinClock(page, '2026-11-16T09:00:00Z');
  await page.emulateMedia({ colorScheme: 'dark' });
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
  expect(await background(page)).toBe(NIGHT);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await background(page)).toBe(DAY);
  expect(await themeColours(page)).toEqual(['#0B1826', '#F4F7F6']);

  // Settings fixes Night on a light phone, and it holds from the first screen after a restart.
  await gotoPlace(page, 'Settings');
  await expect(choice(page)).toHaveText('Phone');
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await expect(choice(page)).toHaveText('Night');
  expect(await background(page)).toBe(NIGHT);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  expect(await themeColours(page)).toEqual(['#0B1826', '#0B1826']);
  expect((await readStored(page)).progress.settings.theme).toBe('night');
  await page.reload();
  await expect(page.locator('.home-screen')).toBeVisible();
  expect(await background(page)).toBe(NIGHT);

  // Day on a dark phone.
  await page.emulateMedia({ colorScheme: 'dark' });
  await gotoPlace(page, 'Settings');
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  expect(await background(page)).toBe(DAY);
  expect(await themeColours(page)).toEqual(['#F4F7F6', '#F4F7F6']);

  // Back to Phone: the phone's own setting again, with no mark on the page.
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  expect(await background(page)).toBe(NIGHT);
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();
  expect(await themeColours(page)).toEqual(['#0B1826', '#F4F7F6']);

  // A figure's plate is white in Night too.
  const plate = await page.evaluate(() => {
    const figure = document.createElement('figure');
    figure.className = 'figure figure-plate';
    document.body.append(figure);
    const colour = getComputedStyle(figure).backgroundColor;
    figure.remove();
    return colour;
  });
  expect(plate).toBe('rgb(255, 255, 255)');

  // The phone's setting changed mid-session: the card follows at once.
  await gotoPlace(page, 'Home');
  await page.locator('.session-button').click();
  await expect(page.locator('.card-screen')).toBeVisible();
  expect(await background(page)).toBe(NIGHT);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await background(page)).toBe(DAY);
  await expect(page.locator('.card-screen')).toBeVisible();
});
