// Invented packs and progress built in code, for tests that need many lessons, many atoms
// or many different states. Nothing here is a fixture file, and none of it is real content.
import { catalogueOf } from '../../engine/catalogue.js';
import { addDays } from '../../engine/days.js';
import { newProgress } from '../../engine/progress.js';
import { reachableCards } from '../../engine/schedule.js';
import { seededRandom } from './seeded.mjs';

const choices = (n, correct = 1) => Array.from({ length: n }, (_, i) => ({ id: String.fromCharCode(97 + i), text: `Choice ${i + 1}`, correct: i < correct }));

// A card of the given type, valid in shape, saying nothing.
export function cardOf(type, cardId, srsKey, more = {}) {
  const base = { cardId, type, prompt: `Card ${cardId}.`, glossaryRefs: [], ...(type === 'teach' ? {} : { srsKey }) };
  switch (type) {
    case 'teach':
      return { ...base, ...more };
    case 'mcq':
    case 'desk':
      return { ...base, options: choices(3), ...more };
    case 'cloze':
      return { ...base, prompt: `Card ${cardId}: ___.`, chips: choices(3), ...more };
    case 'multi':
      return { ...base, options: choices(4, 2), ...more };
    case 'variant':
      return { ...base, term: 'A term', options: choices(4, 2).map((o) => ({ ...o, note: 'A note.' })), ...more };
    case 'match':
      return { ...base, pairs: [1, 2, 3].map((n) => ({ id: `p${n}`, left: `Left ${n}`, right: `Right ${n}` })), ...more };
    case 'order':
      return { ...base, items: [1, 2, 3].map((n) => ({ id: `i${n}`, text: `Step ${n}`, position: n })), ...more };
    default:
      throw new Error(`no card of type ${type}`);
  }
}

// A pack from a short description. Each lesson is { id, cards: ['teach', 'mcq', 'desk:shared-key', ...] }:
// a card's atom is named for the card unless a key follows the type.
export function packOf(lessons, { packId = 'made_pack', order = 1 } = {}) {
  return {
    packId,
    packVersion: '1.0',
    engineMin: '0.2.0',
    contentClass: 'public',
    order,
    title: `Pack ${packId}`,
    lessons: lessons.map((lesson, n) => ({
      lessonId: lesson.id,
      order: n + 1,
      title: `Lesson ${lesson.id}`,
      verification: { status: 'verified' },
      cards: lesson.cards.map((spec, i) => {
        const [type, key, flag] = spec.split(':');
        const cardId = `${lesson.id}_c${String(i + 1).padStart(2, '0')}`;
        return cardOf(type, cardId, `atom.made.${key || cardId.replace(/_/g, '-')}`, flag === 'trap' ? { trap: true } : {});
      }),
    })),
  };
}

export const contentOf = (...packs) => ({ bundle: null, glossary: null, track: null, packs: Object.fromEntries(packs.map((p) => [p.packId, p])) });

const TESTABLE = ['mcq', 'mcq', 'cloze', 'cloze', 'multi', 'match', 'order', 'variant', 'desk'];

// A pack of many lessons, drawn from the random source. Every lesson is at least 60%
// testable, most end on a desk card, and some cards test an atom an earlier card tests.
// With `teachHeavy`, lessons may hold up to twice as many teach cards as tests, which no
// author should write and the engine must still cope with.
export function generatedPack(random, { lessons = 10, teachHeavy = false } = {}) {
  const keys = [];
  const made = [];
  for (let l = 0; l < lessons; l++) {
    const tests = 4 + random.below(6);
    let teaches = random.below(Math.floor(teachHeavy ? tests * 2 : (tests * 2) / 3) + 1);
    const cards = [];
    for (let t = 0; t < tests; t++) {
      const run = Math.min(teaches, random.below(teachHeavy ? 5 : 3));
      teaches -= run;
      for (let i = 0; i < run; i++) cards.push('teach');
      const last = t === tests - 1;
      const type = last ? (random.below(7) === 0 ? 'mcq' : 'desk') : TESTABLE[random.below(TESTABLE.length)];
      const shared = keys.length > 0 && random.below(7) === 0 ? keys[random.below(keys.length)] : null;
      const key = shared || `l${l}t${t}`;
      if (!shared) keys.push(key);
      cards.push(`${type}:${key}${random.below(10) === 0 ? ':trap' : ''}`);
    }
    made.push({ id: `g${String(l + 1).padStart(2, '0')}`, cards });
  }
  return packOf(made, { packId: 'generated' });
}

// Progress somewhere in the content, drawn from the random source: a position, atoms in
// every box with due days around `day`, some atoms not yet introduced, some cards missed,
// and when some cards were last shown. `dueShare` is how many of the atoms are due, out of
// ten. Returns { progress, lastShown }.
export function generatedProgress(random, catalogue, clock, day, { sessionSeconds = 660, dueShare = 4 } = {}) {
  const lessons = catalogue.order.lessons.map((entry) => entry.lesson);
  const reached = random.below(lessons.length + 1);
  const current = reached < lessons.length ? lessons[reached] : null;
  const currentCardIndex = current ? random.below(current.cards.length) : 0;
  const position = {
    currentLesson: current && !(currentCardIndex === 0 && random.below(3) === 0) ? current.lessonId : null,
    currentCardIndex,
    lessonsCompleted: lessons.slice(0, reached).map((lesson) => lesson.lessonId),
    catchingUp: random.below(5) === 0,
  };
  const atoms = {};
  for (const [key, entries] of reachableCards(catalogue, position)) {
    if (random.below(12) === 0) continue; // not yet introduced
    const due = random.below(10) < dueShare;
    const dueOn = addDays(day, due ? -random.below(21) : 1 + random.below(30));
    atoms[key] = {
      box: 1 + random.below(5),
      dueOn,
      introducedOn: addDays(day, -40),
      lastSeenOn: addDays(day, -1 - random.below(30)),
      lastPromotedOn: null,
      correctStreak: random.below(4),
      wrongStreak: 0,
      totalSeen: 1 + random.below(9),
      totalWrong: random.below(3),
      lastMissedCardId: random.below(6) === 0 ? entries[random.below(entries.length)].card.cardId : null,
      trap: catalogue.trapAtoms.has(key),
      changedAt: null,
    };
  }
  const lastShown = new Map();
  for (const cardId of catalogue.cards.keys()) if (random.below(3) > 0) lastShown.set(cardId, 1_000_000 + random.below(5_000_000));
  const base = newProgress({ name: 'Sam', role: 'Baker' }, clock, '0.3.0', seededRandom(1));
  return { progress: { ...base, settings: { ...base.settings, sessionSeconds }, position, atoms }, lastShown };
}

export { catalogueOf };
