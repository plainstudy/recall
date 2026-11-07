import { expect, test } from '@playwright/test';
import { ENGINE_VERSION } from '../../version.js';

test('the test page renders and its service worker activates', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#version')).toHaveText(ENGINE_VERSION);
  await expect(page.locator('#installed')).toHaveText(/^(yes|no)$/);
  await expect(page.locator('#network')).toHaveText('online');
  await expect(page.locator('#worker')).toHaveText('yes');

  const cached = await page.evaluate(async () => {
    const name = (await caches.keys()).find((n) => n.startsWith('engine-'));
    const cache = name ? await caches.open(name) : null;
    return { name, page: Boolean(cache && (await cache.match('./'))) };
  });
  expect(cached.name).toMatch(new RegExp(`^engine-${ENGINE_VERSION.replace(/\./g, '\\.')}@`));
  expect(cached.page).toBe(true);
});
