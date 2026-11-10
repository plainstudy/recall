import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectControlsSized, expectFootInLowerThird, firstRun, gotoPlace, install, readStored, watchErrors } from './helpers.js';

async function glossaryReady(page) {
  await firstRun(page);
  await install(page, 'bundle-bakery-next.json');
  await gotoPlace(page, 'Glossary');
  return page.getByRole('searchbox', { name: 'Search the glossary' });
}

test('glossary search finds names, variants and near-misses, and a term shows its warnings on its own screen without a second tap (test 15)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const search = await glossaryReady(page);
  // Before anything is typed, every term A to Z, the retired one left out.
  await expect(page.locator('.result-term .result-name')).toHaveText(['Banneton', 'Lamination', 'Levain', 'Oven spring', 'Poolish', 'Scoring']);
  await expectControlsSized(page);
  await expectFootInLowerThird(page);

  await search.fill('sour');
  await expect(page.locator('.result .result-name')).toHaveText(['Sourdough starter → Levain']);
  // A near-miss shows its warning in the results, without opening the term.
  await search.fill('POOLISH');
  await expect(page.locator('.result .result-name')).toHaveText(['Poolish', 'Poolish: not the same as Levain.']);
  await expect(page.locator('.result-near-miss .result-note')).not.toHaveText('');

  // The variant opens its term: definition, other names and warning, all on one screen.
  await search.fill('sour');
  await page.locator('.result-variant').click();
  const term = page.locator('.term-screen');
  await expect(term.locator('h1')).toHaveText('Levain');
  await expect(term.locator('.term-definition')).toBeVisible();
  await expect(term.locator('.variant-name')).toHaveText(['Sourdough starter']);
  await expect(term.locator('.warning-line')).toHaveText(['Poolish: not the same as Levain.']);
  await expect(term.locator('.warning-why')).toBeVisible();
  await expect(term.locator('details, [aria-expanded="false"]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Places' }).locator('[aria-current="page"]')).toHaveText('Glossary');
  await expectControlsSized(page);

  // A related term opens from the term's screen, and the phone's Back returns to the one before.
  await term.getByRole('button', { name: 'Poolish', exact: true }).click();
  await expect(page.locator('.term-screen h1')).toHaveText('Poolish');
  await page.goBack();
  await expect(page.locator('.term-screen h1')).toHaveText('Levain');
  // Back keeps the search as it was left.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.glossary-screen')).toBeVisible();
  await expect(search).toHaveValue('sour');

  // Show retired brings the retired term back; the filters are the file's own lists.
  // The retired term is hidden, though another term's near-miss still names it.
  await search.fill('couche');
  await expect(page.locator('.result .result-name')).toHaveText(['Couche: not the same as Banneton.']);
  await page.getByRole('button', { name: 'Show retired', exact: true }).click();
  await expect(page.locator('.result .result-name').first()).toHaveText('Couche');
  await search.fill('');
  await page.getByRole('combobox', { name: 'Domains' }).selectOption({ label: 'Pastry' });
  await expect(page.locator('.result-term .result-name')).toHaveText(['Lamination']);
  expect(errors).toEqual([]);
});

test('acceptance test 34: a search with no match offers Request this term, and the request appears in the next weekly report', async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  const search = await glossaryReady(page);
  await search.fill('rye flour');
  await expect(page.locator('.no-match')).toHaveText('No term matches.');
  await expect(page.locator('.result')).toHaveCount(0);
  await page.getByRole('button', { name: 'Request this term', exact: true }).click();
  await expect(page.locator('.request-done')).toHaveText('Requested. It goes into your next weekly report.');
  await expect(page.getByRole('button', { name: 'Request this term', exact: true })).toHaveCount(0);
  const stored = (await readStored(page)).progress.termRequests;
  expect(stored).toEqual([{ text: 'rye flour', on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), reportedOn: null }]);
  // The same words again, another way, are already waiting.
  await search.fill('Rye-Flour');
  await expect(page.locator('.request-done')).toBeVisible();

  await gotoPlace(page, 'Settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save report now', exact: true }).click()]);
  const report = await readFile(await download.path(), 'utf8');
  expect(report).toContain(`## Requested terms\n- "rye flour", ${stored[0].on}\n`);
  // Saving the report marks the request reported.
  expect((await readStored(page)).progress.termRequests[0].reportedOn).not.toBeNull();
});
