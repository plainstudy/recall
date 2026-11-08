// Weekly reports for screen tests, generated while the test runs and never committed: a
// learner part-way through the invented bakery bundle.
import { writeFile } from 'node:fs/promises';
import { recognise } from '../../engine/formats.js';
import { emptyContent, planImport, progressAfter } from '../../engine/importing.js';
import { newProgress } from '../../engine/progress.js';
import { buildReport } from '../../engine/report.js';
import { ENGINE_VERSION } from '../../version.js';
import { clockAt } from '../unit/clock.mjs';
import { fixtureText, seasonedProgress } from '../unit/fixtures.mjs';

export async function seededReport(path, { name = 'Sam Baker', role = 'Head baker', stamp = '2026-11-15T07:20:00+03:00', change } = {}) {
  const clock = clockAt(stamp);
  const progress = newProgress({ name, role }, clock, ENGINE_VERSION);
  const plan = planImport(recognise(fixtureText('bundle-bakery.json')), { content: emptyContent(), progress, engineVersion: ENGINE_VERSION });
  const seeded = seasonedProgress(progressAfter(progress, plan.nextContent, clock, ENGINE_VERSION));
  const report = buildReport(seeded, plan.nextContent, clock, ENGINE_VERSION);
  await writeFile(path, change ? change(report.text) : report.text);
  return { path, progress: seeded, marked: report.marked, fileName: report.fileName };
}
