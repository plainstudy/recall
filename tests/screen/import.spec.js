import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { MESSAGES, problemText } from '../../engine/validate.js';
import { chooseFile, firstRun, fixturePath, install, readStored, watchErrors } from './helpers.js';

const packWith = async (change) => {
  const pack = JSON.parse(await readFile(fixturePath('pack-bakery.json'), 'utf8'));
  change(pack);
  return { name: 'pack-bakery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) };
};

async function expectRefusal(page, file, message) {
  await chooseFile(page, 'Import', file);
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page.locator('.refusal-after')).toHaveText('Nothing was changed.');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.start-screen')).toBeVisible();
}

test('a pack is imported after its glossary; a malformed one, or one needing a newer engine, is refused and nothing changes (test 17)', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await firstRun(page);
  await expectRefusal(page, 'pack-bakery.json', problemText({ item: 'the pack', message: MESSAGES.noGlossary }));
  await install(page, 'glossary.json');
  await expect(page.locator('.notice')).toHaveText('Glossary 1.1 installed.');
  const before = await readStored(page);

  await expectRefusal(
    page,
    await packWith((p) => (p.engineMin = '0.3.0')),
    'This pack needs engine 0.3.0 or later. This app is 0.2.0. Restart the app when it has updated.',
  );
  await expectRefusal(
    page,
    await packWith((p) => p.lessons[0].cards[1].options.splice(2)),
    `Card bk_l01_c02: ${MESSAGES.badCount('mcq', 'options', 3, 4, 2)}`,
  );
  await expectRefusal(page, { name: 'pack.json', mimeType: 'application/json', buffer: Buffer.from('{"packId": "x", "lessons": [') }, "This file isn't something the app can import.");
  expect(await readStored(page)).toEqual(before);
  await expect(page.locator('.lesson')).toHaveCount(0);

  await chooseFile(page, 'Import', 'pack-bakery.json');
  await expect(page.locator('.change-line')).toHaveText(['Pack Bread basics 1.0, new.']);
  await expect(page.locator('.warning')).toHaveText([
    'Card bk_l02_c01: its figure "fig_not_in_pack" isn\'t in the pack, so the card shows without it.',
    '1 lesson is marked needs-review.',
  ]);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.locator('.notice')).toHaveText('Pack Bread basics 1.0 installed.');
  await expect(page.locator('.lesson')).toHaveCount(2);
  expect(Object.keys((await readStored(page)).content).sort()).toEqual(['glossary', 'pack:bakery_basics']);
  await expectRefusal(page, 'pack-bakery.json', MESSAGES.alreadyInstalled('pack', '1.0'));
  expect(errors).toEqual([]);
});

test('Cancel leaves everything as it was', async ({ page }) => {
  await firstRun(page);
  await chooseFile(page, 'Import', 'bundle-bakery.json');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Nothing installed yet.')).toBeVisible();
  expect((await readStored(page)).content).toEqual({});
  // The phone's Back cancels too.
  await chooseFile(page, 'Import', 'glossary.json');
  await expect(page.locator('.import-confirm')).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Nothing installed yet.')).toBeVisible();
  expect((await readStored(page)).content).toEqual({});
});

test('a newer glossary says what changes and leaves progress alone; the older one is then refused (test 30)', async ({ page }) => {
  await firstRun(page);
  await install(page, 'bundle-bakery.json');
  const before = (await readStored(page)).progress;
  await chooseFile(page, 'Import', 'glossary-next.json');
  await expect(page.locator('.change-line')).toHaveText(['Glossary 1.1 → 1.2, with 1 new, 1 changed and 1 retired.', 'Your progress stays.']);
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.locator('.installed-name').nth(2)).toHaveText('Glossary 1.2');
  const after = (await readStored(page)).progress;
  const { savedOn: s1, installed: i1, ...rest1 } = before;
  const { savedOn: s2, installed: i2, ...rest2 } = after;
  expect(rest2).toEqual(rest1);
  expect(i2.glossaryVersion).toBe('1.2');
  await chooseFile(page, 'Import', 'glossary.json');
  await expect(page.getByRole('alert')).toHaveText(MESSAGES.older('glossary', '1.1', '1.2'));
});
