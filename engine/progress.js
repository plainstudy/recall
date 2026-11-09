// The progress object (spec §3.7): one per phone, stored, mirrored and carried whole by
// the weekly report. This module makes a new learner's, checks one at the current schema,
// and works out which of two copies is newer. Older schemas are brought up to date in
// migrate.js before they are checked.

import { instantOf, isDay, isStamp, learnerDay, localStamp } from './days.js';
import { isId, newId } from './ids.js';
import { isVersion } from './versions.js';

export const SCHEMA_VERSION = 3;
export const SESSION_SECONDS = [300, 480, 660, 840];
export const DEFAULT_SESSION_SECONDS = 660;
export const THEMES = ['phone', 'night', 'day'];
export const PROFILE_MAX = 40;
export const STARTING_FREEZES = 2;

export const PROGRESS_MESSAGES = {
  nameMissing: 'Enter your name.',
  roleMissing: 'Enter your role.',
  tooLong: `Use ${PROFILE_MAX} characters or fewer.`,
  newerApp: 'This report comes from a newer version of the app. Restart the app when it has updated.',
  mismatch: "This report's progress data isn't in the form the app expects, so it can't be restored.",
};

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isCount = (x) => Number.isInteger(x) && x >= 0;
const isText = (x) => typeof x === 'string';

// Name and role, trimmed: { ok, profile, problems: { name?, role? } }.
export function checkProfile({ name, role }) {
  const clean = { name: String(name ?? '').trim(), role: String(role ?? '').trim() };
  const problems = {};
  for (const field of ['name', 'role']) {
    if (clean[field] === '') problems[field] = PROGRESS_MESSAGES[`${field}Missing`];
    else if ([...clean[field]].length > PROFILE_MAX) problems[field] = PROGRESS_MESSAGES.tooLong;
  }
  return { ok: Object.keys(problems).length === 0, profile: clean, problems };
}

// What `installed` says before anything is.
export const emptyInstalled = () => ({
  bundleId: null,
  bundleVersion: null,
  title: null,
  reportPrefix: null,
  trackId: null,
  trackVersion: null,
  trackTitle: null,
  glossaryVersion: null,
  packs: {},
});

// What `installed` says for the content on the phone: { bundle, glossary, track, packs }.
export function installedFrom(content) {
  const { bundle, glossary, track } = content;
  return {
    bundleId: bundle ? bundle.bundleId : null,
    bundleVersion: bundle ? bundle.bundleVersion : null,
    title: bundle ? bundle.title : null,
    reportPrefix: bundle && bundle.reportPrefix != null ? bundle.reportPrefix : null,
    trackId: track ? track.trackId : null,
    trackVersion: track ? track.trackVersion : null,
    trackTitle: track ? track.title : null,
    glossaryVersion: glossary ? glossary.glossaryVersion : null,
    packs: Object.fromEntries(Object.values(content.packs || {}).map((p) => [p.packId, p.packVersion])),
  };
}

// The time and version every saved copy carries.
export const stamped = (progress, clock, engineVersion) => ({ ...progress, savedOn: localStamp(clock), engineVersion });

// A new learner's progress, made at first run, with an id for this phone's copy of the app
// and one for the learner.
export function newProgress(profile, clock, engineVersion, random) {
  return stamped(
    {
      schemaVersion: SCHEMA_VERSION,
      savedOn: null,
      engineVersion,
      deviceId: newId(random),
      profile: { learnerId: newId(random), name: profile.name, role: profile.role, createdOn: learnerDay(clock) },
      installed: emptyInstalled(),
      settings: { sessionSeconds: DEFAULT_SESSION_SECONDS, theme: 'phone' },
      streak: {
        current: 0,
        longest: 0,
        lastCountedDay: null,
        checkedThrough: null,
        freezesRemaining: STARTING_FREEZES,
        freezesUsedOn: [],
        countedRun: 0,
        dayBoundaryHour: 4,
      },
      position: { currentLesson: null, currentCardIndex: 0, lessonsCompleted: [], catchingUp: false },
      atoms: {},
      families: {},
      confusions: [],
      termRequests: [],
      sessionLog: [],
      reportsSavedOn: [],
    },
    clock,
    engineVersion,
  );
}

// Of two copies, the one saved later; the first on a tie, or when only it is readable.
export function newerOf(first, second) {
  if (!second) return first || null;
  if (!first) return second;
  const a = instantOf(first.savedOn);
  const b = instantOf(second.savedOn);
  if (Number.isNaN(b)) return first;
  if (Number.isNaN(a)) return second;
  return b > a ? second : first;
}

const dayOrNull = (x) => x === null || isDay(x);
const listOf = (x, each) => Array.isArray(x) && x.every(each);

// The first field that doesn't fit the progress object, or null.
function misfit(p) {
  const checks = [
    ['savedOn', () => isStamp(p.savedOn)],
    ['engineVersion', () => isVersion(p.engineVersion)],
    ['deviceId', () => isId(p.deviceId)],
    [
      'profile',
      () => isObject(p.profile) && isId(p.profile.learnerId) && isText(p.profile.name) && isText(p.profile.role) && isDay(p.profile.createdOn),
    ],
    ['installed', () => isObject(p.installed)],
    ['settings', () => isObject(p.settings) && SESSION_SECONDS.includes(p.settings.sessionSeconds) && THEMES.includes(p.settings.theme)],
    [
      'streak',
      () =>
        isObject(p.streak) &&
        isCount(p.streak.current) &&
        isCount(p.streak.longest) &&
        dayOrNull(p.streak.lastCountedDay) &&
        dayOrNull(p.streak.checkedThrough) &&
        isCount(p.streak.freezesRemaining) &&
        p.streak.freezesRemaining <= STARTING_FREEZES &&
        listOf(p.streak.freezesUsedOn, isDay) &&
        isCount(p.streak.countedRun) &&
        Number.isInteger(p.streak.dayBoundaryHour),
    ],
    [
      'position',
      () =>
        isObject(p.position) &&
        (p.position.currentLesson === null || isText(p.position.currentLesson)) &&
        isCount(p.position.currentCardIndex) &&
        listOf(p.position.lessonsCompleted, isText) &&
        typeof p.position.catchingUp === 'boolean',
    ],
    [
      'atoms',
      () =>
        isObject(p.atoms) &&
        Object.values(p.atoms).every(
          (a) => isObject(a) && Number.isInteger(a.box) && a.box >= 1 && a.box <= 5 && isDay(a.dueOn) && (a.changedAt === null || isStamp(a.changedAt)),
        ),
    ],
    ['families', () => isObject(p.families)],
    ['confusions', () => Array.isArray(p.confusions)],
    ['termRequests', () => listOf(p.termRequests, (r) => isObject(r) && isText(r.text) && isDay(r.on) && dayOrNull(r.reportedOn))],
    ['sessionLog', () => listOf(p.sessionLog, (s) => isObject(s) && isId(s.id))],
    ['reportsSavedOn', () => listOf(p.reportsSavedOn, isDay)],
  ];
  const failed = checks.find(([, ok]) => !ok());
  return failed ? failed[0] : null;
}

// A progress object at the current schema: { ok: true } or { ok: false, message, field }.
export function checkProgress(p) {
  if (!isObject(p) || !Number.isInteger(p.schemaVersion)) return { ok: false, message: PROGRESS_MESSAGES.mismatch, field: 'schemaVersion' };
  if (p.schemaVersion > SCHEMA_VERSION) return { ok: false, message: PROGRESS_MESSAGES.newerApp, field: 'schemaVersion' };
  if (p.schemaVersion < SCHEMA_VERSION) return { ok: false, message: PROGRESS_MESSAGES.mismatch, field: 'schemaVersion' };
  const field = misfit(p);
  return field ? { ok: false, message: PROGRESS_MESSAGES.mismatch, field } : { ok: true };
}

// The progress after a restore: the report's, the learner's id included, all but
// `installed`, which always describes the content actually on this phone, and `deviceId`,
// which names this phone's own copy of the app.
export function restoredProgress(phone, fromReport, clock, engineVersion) {
  return stamped({ ...fromReport, deviceId: phone.deviceId, installed: phone.installed }, clock, engineVersion);
}
