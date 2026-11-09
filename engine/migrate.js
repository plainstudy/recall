// Progress saved by an older version of the app, brought up to the current schema one
// step at a time, then checked. It runs on start and before a report's progress is
// restored, so a report from an older app restores. Only a newer schema is refused.

import { newId } from './ids.js';
import { PROGRESS_MESSAGES, SCHEMA_VERSION, checkProgress } from './progress.js';

const OLDEST_SCHEMA = 2;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// One step per schema version: STEPS[n] turns schema n into schema n + 1.
const STEPS = {
  // 2 to 3: an id for the learner and one for this phone's copy, an id on every session
  // record, and on every atom the time of its last change, not known yet.
  2(progress, random) {
    const { schemaVersion, savedOn, engineVersion, profile, atoms, sessionLog, ...rest } = progress;
    return {
      schemaVersion: 3,
      savedOn,
      engineVersion,
      deviceId: newId(random),
      profile: isObject(profile) ? { learnerId: newId(random), ...profile } : profile,
      ...rest,
      atoms: isObject(atoms)
        ? Object.fromEntries(Object.entries(atoms).map(([key, atom]) => [key, isObject(atom) ? { ...atom, changedAt: null } : atom]))
        : atoms,
      sessionLog: Array.isArray(sessionLog) ? sessionLog.map((entry) => (isObject(entry) ? { id: newId(random), ...entry } : entry)) : sessionLog,
    };
  },
};

// { ok: true, progress, migrated } with the progress at the current schema, or
// { ok: false, message, field }.
export function upgradeProgress(raw, random) {
  const mismatch = { ok: false, message: PROGRESS_MESSAGES.mismatch, field: 'schemaVersion' };
  if (!isObject(raw) || !Number.isInteger(raw.schemaVersion)) return mismatch;
  if (raw.schemaVersion > SCHEMA_VERSION) return { ok: false, message: PROGRESS_MESSAGES.newerApp, field: 'schemaVersion' };
  if (raw.schemaVersion < OLDEST_SCHEMA) return mismatch;
  let progress = raw;
  while (progress.schemaVersion < SCHEMA_VERSION) progress = STEPS[progress.schemaVersion](progress, random);
  const check = checkProgress(progress);
  return check.ok ? { ok: true, progress, migrated: progress !== raw } : check;
}
