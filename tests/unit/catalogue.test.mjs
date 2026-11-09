import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTIMATE_SECONDS, blocksOf, catalogueOf, estimateOf } from '../../engine/catalogue.js';
import { clockAt } from './clock.mjs';
import { fixture } from './fixtures.mjs';
import { phoneWith } from './phone.mjs';

const clock = () => clockAt('2026-11-15T07:14:00+03:00');

test('each card type has its planned seconds', () => {
  assert.deepEqual(ESTIMATE_SECONDS, { teach: 25, mcq: 20, multi: 30, match: 40, order: 35, hotspot: 30, cloze: 20, variant: 35, desk: 60 });
  assert.equal(estimateOf({ type: 'desk' }), 60);
  assert.equal(estimateOf({ type: 'teach' }), 25);
});

test('a lesson splits into blocks: a run of teach cards with the test after them, or a test alone', () => {
  const t = { type: 'teach' };
  const q = { type: 'mcq' };
  assert.deepEqual(blocksOf([t, q, t, t, q, q, q]), [[0, 1], [2, 3, 4], [5], [6]]);
  assert.deepEqual(blocksOf([t, q, t, t, q, q, q], 3), [[3, 4], [5], [6]], 'from a card part-way through');
  assert.deepEqual(blocksOf([q, t, t]), [[0], [1, 2]], 'teach cards left at the end form a last block');
  assert.deepEqual(blocksOf([t, q], 2), []);
});

test('the index holds every shown lesson and card, atoms with their cards in file order, and trap atoms', () => {
  const { catalogue } = phoneWith('bundle-bakery.json', clock());
  assert.deepEqual([...catalogue.lessons.keys()], ['bk_l01', 'bk_l02'], 'the unverified lesson is passed over');
  assert.equal(catalogue.lessons.get('bk_l02').inOrder, true);
  assert.equal(catalogue.lessons.get('bk_l01').packId, 'bakery_basics');

  const where = catalogue.cards.get('bk_l02_c04');
  assert.deepEqual([where.lessonId, where.index, where.card.type], ['bk_l02', 3, 'mcq']);
  assert.equal(catalogue.cards.get('bk_l01_c01').seq, 0);
  assert.ok(catalogue.cards.get('bk_l02_c01').seq > catalogue.cards.get('bk_l01_c08').seq);
  assert.equal(catalogue.cards.has('bk_l03_c01'), false);

  assert.deepEqual(catalogue.atoms.get('atom.ingredient.levain').map((e) => e.card.cardId), ['bk_l01_c02']);
  assert.equal(catalogue.atoms.size, 13, 'one per testable card in this pack');
  assert.deepEqual([...catalogue.trapAtoms].sort(), ['atom.ingredient.poolish', 'atom.tool.banneton']);
});

test('several cards may share an atom, and lessons outside the study order are still indexed', () => {
  const pack = fixture('pack-bakery.json');
  pack.lessons[1].cards[2].srsKey = 'atom.ingredient.levain';
  const other = fixture('pack-bakery.json');
  other.packId = 'bakery_more';
  other.order = 2;
  for (const lesson of other.lessons) {
    lesson.lessonId = lesson.lessonId.replace('bk_', 'bm_');
    lesson.prerequisites = [];
    for (const card of lesson.cards) card.cardId = card.cardId.replace('bk_', 'bm_');
  }
  const catalogue = catalogueOf({
    glossary: fixture('glossary.json'),
    track: fixture('track-bakery.json'),
    packs: { bakery_basics: pack, bakery_more: other },
  });
  assert.deepEqual(catalogue.order.lessons.map((e) => e.lesson.lessonId), ['bk_l01', 'bk_l02'], "the track doesn't list the second pack");
  assert.deepEqual([...catalogue.lessons.keys()], ['bk_l01', 'bk_l02', 'bm_l01', 'bm_l02']);
  assert.equal(catalogue.lessons.get('bm_l01').inOrder, false);
  assert.deepEqual(
    catalogue.atoms.get('atom.ingredient.levain').map((e) => e.card.cardId),
    ['bk_l01_c02', 'bk_l02_c03', 'bm_l01_c02'],
    'file order: the study order first, then the rest',
  );
});

test("a card's family is that of the first term in its glossaryRefs that has one", () => {
  const { catalogue } = phoneWith('bundle-bakery.json', clock());
  const card = catalogue.cards.get('bk_l01_c02').card;
  assert.equal(catalogue.familyOf(card), 'leavening');
  assert.equal(catalogue.familyOf({ ...card, glossaryRefs: ['not-a-term', 'banneton', 'levain'] }), 'shaping');
  assert.equal(catalogue.familyOf({ ...card, glossaryRefs: [] }), null);
  assert.equal(catalogue.familyOf({ type: 'mcq' }), null);
  assert.equal(catalogueOf({ glossary: null, track: null, packs: {} }).familyOf(card), null);
});
