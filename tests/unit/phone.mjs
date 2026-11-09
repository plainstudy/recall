// A phone for unit tests: a new learner with a fixture installed, as Install leaves it.
import { catalogueOf } from '../../engine/catalogue.js';
import { recognise } from '../../engine/formats.js';
import { emptyContent, planImport, progressAfter } from '../../engine/importing.js';
import { newProgress } from '../../engine/progress.js';
import { fixtureText } from './fixtures.mjs';
import { seededRandom } from './seeded.mjs';

export const ENGINE = '0.3.0';

// Installs a fixture, or an object of the given kind, over the phone's state.
export function installOn(phone, file, clock) {
  const recognised = typeof file === 'string' ? recognise(fixtureText(file)) : file;
  const plan = planImport(recognised, { content: phone.content, progress: phone.progress, engineVersion: ENGINE, random: seededRandom(9) });
  if (!plan.ok) throw new Error(plan.message);
  const progress = progressAfter(phone.progress, plan.nextContent, clock, ENGINE);
  return { content: plan.nextContent, progress, catalogue: catalogueOf(plan.nextContent) };
}

// { content, progress, catalogue } with these files installed in turn.
export function phoneWith(files, clock, profile = { name: 'Sam', role: 'Baker' }) {
  let phone = { content: emptyContent(), progress: newProgress(profile, clock, ENGINE, seededRandom(1)) };
  for (const file of [files].flat()) phone = installOn(phone, file, clock);
  return { catalogue: catalogueOf(phone.content), ...phone };
}

// The same phone with its position changed.
export const at = (phone, position) => ({ ...phone, progress: { ...phone.progress, position: { ...phone.progress.position, ...position } } });
