import { expect, test } from '@playwright/test';
import { ENGINE_VERSION } from '../../version.js';
import { gotoPlace, install, openEndQuestion, watchErrors } from './helpers.js';

// The version after this one, published while the app runs.
const NEXT = ENGINE_VERSION.replace(/\d+$/, (n) => String(Number(n) + 1));
const escaped = (v) => v.replace(/\./g, '\\.');

const controllerIs = (page, part) =>
  page.waitForFunction((p) => Boolean(navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.includes(p)), part);

async function versionInSettings(page) {
  await gotoPlace(page, 'Settings');
  const text = await page.locator('.settings-about .version').textContent();
  await gotoPlace(page, 'Home');
  return text;
}

test('acceptance test 40: a newer version is prepared in the background and offered on Home, never during a session; Restart switches to it; offline the app opens at once', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const base = '/__versions/t40/';
  await page.goto(base);
  await page.getByLabel('Your name').fill('Sam');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await install(page, 'bundle-bakery-next.json');
  await controllerIs(page, `sw.js?v=${ENGINE_VERSION}`);
  await expect(page.locator('.notice-update')).toHaveCount(0);

  // A newer version is published. At the next start the app finds it and prepares it.
  await page.request.get(`${base}__set?v=${NEXT}`);
  await page.reload();
  const notice = page.locator('.notice-update');
  await expect(notice.locator('p')).toHaveText(`Version ${NEXT} is ready. Restart to use it.`, { timeout: 20_000 });
  expect(await versionInSettings(page)).toBe(`Version ${ENGINE_VERSION}`);

  // Never during a session: the session runs on the version it started with.
  await page.locator('.session-button').click();
  await expect(page.locator('.card-screen')).toBeVisible();
  await expect(notice).toHaveCount(0);
  await openEndQuestion(page);
  await page.locator('.end-question').getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(notice).toHaveCount(1);

  // Restart switches to it.
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Restart', exact: true }).click()]);
  await expect(page.locator('.home-screen')).toBeVisible();
  await controllerIs(page, `sw.js?v=${NEXT}`);
  expect(await versionInSettings(page)).toBe(`Version ${NEXT}`);
  await expect(notice).toHaveCount(0);
  const caches = await page.evaluate(() => caches.keys());
  expect(caches.filter((n) => n.startsWith('engine-'))).toEqual([expect.stringMatching(new RegExp(`^engine-${escaped(NEXT)}@`))]);

  // Offline, the app opens at once on the version it has.
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.home-screen')).toBeVisible();
  expect(await versionInSettings(page)).toBe(`Version ${NEXT}`);
  expect(errors).toEqual([]);
});

test('a phone on a worker from before 1.0.0, which served from the network first, moves to this version at once on its next online start', async ({ page }) => {
  const base = '/__versions/move/';
  await page.goto(`${base}__old-page`);
  await controllerIs(page, '__old-worker.js');
  await page.goto(base);
  await expect(page.getByLabel('Your name')).toBeVisible();
  await page.evaluate(() => {
    window.stillTheSamePage = true;
  });
  await controllerIs(page, `sw.js?v=${ENGINE_VERSION}`);
  // It took over without reloading the page, and keeps only its own cache.
  expect(await page.evaluate(() => window.stillTheSamePage)).toBe(true);
  const names = await page.evaluate(() => caches.keys());
  expect(names.filter((n) => n.startsWith('engine-'))).toEqual([expect.stringMatching(new RegExp(`^engine-${escaped(ENGINE_VERSION)}@.*/__versions/move/$`))]);
});

test('a worker whose name and published version disagree is refused, and the running one stays', async ({ page }) => {
  const base = '/__versions/clash/';
  await page.goto(base);
  await controllerIs(page, `sw.js?v=${ENGINE_VERSION}`);
  // The site now publishes another version, but a worker is asked for under this one's name.
  await page.request.get(`${base}__set?v=${NEXT}`);
  const outcome = await page.evaluate(async (v) => {
    const registration = await navigator.serviceWorker.register(`./sw.js?v=${v}-mismatch`);
    const worker = registration.installing;
    if (!worker) return 'nothing installing';
    return new Promise((resolve) => worker.addEventListener('statechange', () => worker.state === 'redundant' && resolve('refused')));
  }, ENGINE_VERSION);
  expect(outcome).toBe('refused');
  expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).toContain(`sw.js?v=${ENGINE_VERSION}`);
});
