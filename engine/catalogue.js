// One index of the content on the phone, built once per change of content and used by the
// scheduler, session assembly, the sessions themselves and the report.
//
// `content` is what is installed: { glossary, track, packs }. Cards are as readPack reads
// them, ready for display.

import { lessonOrder } from './lessons.js';
import { isTestable } from './scoring.js';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The seconds a card of each type is planned to take (spec §3.4).
export const ESTIMATE_SECONDS = { teach: 25, mcq: 20, multi: 30, match: 40, order: 35, hotspot: 30, cloze: 20, variant: 35, desk: 60 };
const OTHER_SECONDS = 30;

export const estimateOf = (card) => ESTIMATE_SECONDS[card && card.type] ?? OTHER_SECONDS;

// A lesson's cards from `from` onwards as blocks of card indexes. A block is a run of
// teach cards together with the testable card after them, or a testable card on its own.
// Teach cards left at the very end, with no test after them, form a last block.
export function blocksOf(cards, from = 0) {
  const blocks = [];
  let run = [];
  for (let i = from; i < cards.length; i++) {
    run.push(i);
    if (isTestable(cards[i])) {
      blocks.push(run);
      run = [];
    }
  }
  if (run.length > 0) blocks.push(run);
  return blocks;
}

// The index:
//   order     the lessons in study order, and where the track stops (lessons.lessonOrder)
//   lessons   Map lessonId -> { lesson, packId, packTitle, inOrder }: every lesson on the
//             phone that is shown, those outside the study order included
//   cards     Map cardId -> { card, lessonId, index, seq }, seq being its place in file
//             order: lessons in study order first, then the rest, each lesson's cards as
//             the file has them
//   atoms     Map key -> its testable cards' entries, in file order
//   trapAtoms the keys of atoms with at least one trap card
//   familyOf(card)  the family of the first term in the card's glossaryRefs that has one
export function catalogueOf(content) {
  const packs = isObject(content) && isObject(content.packs) ? content.packs : {};
  const order = lessonOrder(content);
  const inOrder = new Set(order.lessons.map((entry) => entry.lesson.lessonId));
  const rest = lessonOrder({ track: null, packs }).lessons.filter((entry) => !inOrder.has(entry.lesson.lessonId));

  const lessons = new Map();
  const cards = new Map();
  const atoms = new Map();
  const trapAtoms = new Set();
  let seq = 0;
  for (const entry of [...order.lessons, ...rest]) {
    const { lesson } = entry;
    if (lessons.has(lesson.lessonId)) continue;
    lessons.set(lesson.lessonId, { lesson, packId: entry.packId, packTitle: entry.packTitle, inOrder: inOrder.has(lesson.lessonId) });
    lesson.cards.forEach((card, index) => {
      const where = { card, lessonId: lesson.lessonId, index, seq: seq++ };
      if (card.cardId != null && !cards.has(card.cardId)) cards.set(card.cardId, where);
      if (isTestable(card) && typeof card.srsKey === 'string') {
        if (!atoms.has(card.srsKey)) atoms.set(card.srsKey, []);
        atoms.get(card.srsKey).push(where);
        if (card.trap === true) trapAtoms.add(card.srsKey);
      }
    });
  }

  const glossary = isObject(content) ? content.glossary : null;
  const families = new Map();
  for (const term of isObject(glossary) && Array.isArray(glossary.terms) ? glossary.terms : []) {
    if (isObject(term) && typeof term.family === 'string' && term.family !== '') families.set(term.id, term.family);
  }
  const familyOf = (card) => {
    const refs = card && Array.isArray(card.glossaryRefs) ? card.glossaryRefs : [];
    const ref = refs.find((id) => families.has(id));
    return ref === undefined ? null : families.get(ref);
  };

  return { order, lessons, cards, atoms, trapAtoms, familyOf };
}
