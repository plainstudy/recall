// Fixture loading for unit tests: every call returns a fresh copy, so a test can change
// it in code without touching another test's.
import { readFileSync } from 'node:fs';

export const fixtureText = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
export const fixture = (name) => JSON.parse(fixtureText(name));

// What is installed, in the shape the engine's checks take.
export const nothingInstalled = () => ({ bundle: null, glossary: null, track: null, packs: {} });

export function installedWith({ bundle = null, glossary = null, track = null, packs = [] } = {}) {
  return { bundle, glossary, track, packs: Object.fromEntries(packs.map((p) => [p.packId, p])) };
}

export const ctxFor = (installed, engineVersion = '0.2.0') => ({ engineVersion, installed });

// A learner part-way through, for tests that need progress with something in it: atoms in
// several boxes, a streak, a position, sessions, a request and a confusion. Invented.
export function seasonedProgress(base) {
  return {
    ...base,
    streak: { ...base.streak, current: 5, longest: 9, lastCountedDay: '2026-11-14', checkedThrough: '2026-11-13', freezesRemaining: 1, freezesUsedOn: ['2026-11-03'], countedRun: 3 },
    position: { currentLesson: 'bk_l02', currentCardIndex: 3, lessonsCompleted: ['bk_l01'], catchingUp: false },
    atoms: {
      'atom.ingredient.levain': { box: 3, dueOn: '2026-11-20', introducedOn: '2026-11-02', lastSeenOn: '2026-11-13', lastPromotedOn: '2026-11-13', correctStreak: 2, wrongStreak: 0, totalSeen: 4, totalWrong: 1, lastMissedCardId: null, trap: false },
      'atom.ingredient.poolish': { box: 1, dueOn: '2026-11-15', introducedOn: '2026-11-05', lastSeenOn: '2026-11-14', lastPromotedOn: null, correctStreak: 0, wrongStreak: 2, totalSeen: 3, totalWrong: 3, lastMissedCardId: 'bk_l02_c04', trap: true },
      'atom.technique.scoring': { box: 2, dueOn: '2026-11-16', introducedOn: '2026-11-06', lastSeenOn: '2026-11-13', lastPromotedOn: '2026-11-10', correctStreak: 0, wrongStreak: 1, totalSeen: 3, totalWrong: 2, lastMissedCardId: null, trap: false },
      'atom.tool.banneton': { box: 5, dueOn: '2027-01-10', introducedOn: '2026-10-01', lastSeenOn: '2026-11-11', lastPromotedOn: '2026-11-11', correctStreak: 5, wrongStreak: 0, totalSeen: 6, totalWrong: 0, lastMissedCardId: null, trap: true },
    },
    families: { leavening: { recent: [1, 0, 0, 1] } },
    confusions: [
      { pair: ['levain', 'poolish'], count: 2, countAtLastContrast: 0, lastOn: '2026-11-14' },
      { pair: ['banneton', 'couche'], count: 1, countAtLastContrast: 0, lastOn: '2026-11-12' },
    ],
    termRequests: [
      { text: 'crumb shot', on: '2026-11-13', reportedOn: null },
      { text: 'autolyse', on: '2026-11-01', reportedOn: '2026-11-08' },
    ],
    sessionLog: [
      { day: '2026-11-13', kind: 'daily', lengthSec: 660, durationSec: 600, newCards: 6, reviewCards: 4, reAsks: 1, answered: 9, correct: 7, traps: [1, 2], families: { leavening: [4, 3], shaping: [2, 2] }, completed: true },
      { day: '2026-11-14', kind: 'daily', lengthSec: 300, durationSec: 280, newCards: 2, reviewCards: 3, reAsks: 0, answered: 5, correct: 3, traps: [0, 1], families: { leavening: [3, 1] }, completed: true },
      { day: '2026-11-14', kind: 'redo', lengthSec: 0, durationSec: 200, newCards: 0, reviewCards: 0, reAsks: 0, answered: 6, correct: 6, traps: [0, 0], families: {}, completed: true },
      { day: '2026-10-01', kind: 'daily', lengthSec: 660, durationSec: 640, newCards: 9, reviewCards: 0, reAsks: 0, answered: 8, correct: 8, traps: [0, 0], families: { oven: [8, 8] }, completed: true },
    ],
    reportsSavedOn: ['2026-11-08'],
  };
}
