import { expect, test } from '@playwright/test';
import { APP_NAME, SHORT_NAME } from '../../ui/app-name.js';
import { ENGINE_VERSION } from '../../version.js';
import { precacheList } from '../precache-list.mjs';
import { watchErrors } from './helpers.js';

test('acceptance test 1: the app opens under its name, with its manifest, icons and version, and its worker caches the whole shell', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle(APP_NAME);
  await expect(page.getByRole('heading', { name: APP_NAME })).toBeVisible();
  await expect(page.getByText(`Version ${ENGINE_VERSION}`)).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();

  // The manifest as the browser reads it: names, full screen, colours and icons.
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    return (await fetch(link.href)).json();
  });
  expect(manifest.name).toBe(APP_NAME);
  expect(manifest.short_name).toBe(SHORT_NAME);
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation).toBe('portrait');
  expect(manifest.background_color).toBe('#0B1826');
  expect(manifest.theme_color).toBe('#0B1826');
  expect(manifest.icons.map((i) => [i.sizes, i.purpose || 'any'])).toEqual([
    ['192x192', 'any'],
    ['512x512', 'any'],
    ['512x512', 'maskable'],
  ]);
  // Every icon loads as an image of the size it claims.
  const sizes = await page.evaluate(
    (srcs) =>
      Promise.all(
        srcs.map(
          (src) =>
            new Promise((resolve) => {
              const img = new Image();
              img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
              img.onerror = () => resolve('failed');
              img.src = src;
            }),
        ),
      ),
    manifest.icons.map((i) => i.src),
  );
  expect(sizes).toEqual(manifest.icons.map((i) => i.sizes));

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
