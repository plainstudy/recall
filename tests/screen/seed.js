// Weekly reports for screen tests, generated while the test runs and never committed: a
// learner part-way through the invented bakery bundle.
import { writeFile } from 'node:fs/promises';
import { recognise } from '../../engine/formats.js';
import { emptyContent, planImport, progressAfter } from '../../engine/importing.js';
import { newProgress } from '../../engine/progress.js';
import { buildReport } from '../../engine/report.js';
import { APP_NAME } from '../../ui/app-name.js';
import { ENGINE_VERSION } from '../../version.js';
import { clockAt } from '../unit/clock.mjs';
import { asSchemaTwo, fixtureText, seasonedProgress } from '../unit/fixtures.mjs';
import { seededRandom } from '../unit/seeded.mjs';

export const SEED_STAMP = '2026-11-15T07:20:00+03:00';

// Options: `bundle` names the bundle fixture installed; `progress` changes the seeded
// progress before the report is made; `older` writes the report as an app at schema 2
// did; `change` edits the finished text.
export async function seededReport(
  path,
  { name = 'Sam Baker', role = 'Head baker', stamp = SEED_STAMP, bundle = 'bundle-bakery.json', progress: adjust, older = false, change } = {},
) {
  const clock = clockAt(stamp);
  const progress = newProgress({ name, role }, clock, ENGINE_VERSION, seededRandom(7));
  const plan = planImport(recognise(fixtureText(bundle)), { content: emptyContent(), progress, engineVersion: ENGINE_VERSION });
  let seeded = seasonedProgress(progressAfter(progress, plan.nextContent, clock, ENGINE_VERSION));
  if (adjust) seeded = adjust(seeded);
  if (older) seeded = asSchemaTwo(seeded);
  const report = buildReport(seeded, plan.nextContent, clock, ENGINE_VERSION, APP_NAME);
  await writeFile(path, change ? change(report.text) : report.text);
  return { path, progress: seeded, marked: report.marked, fileName: report.fileName };
}
