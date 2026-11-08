import { expect, test } from '@playwright/test';
import { ENGINE_VERSION } from '../../version.js';
import { precacheList } from '../precache-list.mjs';
import { watchErrors } from './helpers.js';

test('the app opens as Recall, shows its version, and its worker caches the whole shell', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Recall');
  await expect(page.getByRole('heading', { name: 'Recall' })).toBeVisible();
  await expect(page.getByText(`Version ${ENGINE_VERSION}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open a pack file' })).toBeVisible();

  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  expect(manifest.name).toBe('Recall');
  expect(manifest.short_name).toBe('Recall');

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cached = await page.evaluate(async () => {
    const name = (await caches.keys()).find((n) => n.startsWith('engine-'));
    const cache = await caches.open(name);
    return { name, paths: (await cache.keys()).map((request) => new URL(request.url).pathname) };
  });
  expect(cached.name).toMatch(new RegExp(`^engine-${ENGINE_VERSION.replace(/\./g, '\\.')}@`));
  const listed = (await precacheList()).map((path) => path.slice(1));
  expect(cached.paths.sort()).toEqual(listed.sort());
  expect(errors).toEqual([]);
});
