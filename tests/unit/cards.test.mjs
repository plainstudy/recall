import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { MESSAGES, parseViewBox, readCard, readPack, regionShape, withPairIds } from '../../engine/cards.js';

const loadFixture = async (name) =>
  JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

test('a pack in the current shape reads, with lessons in order and cards in file order', async () => {
  const { ok, pack } = readPack(await loadFixture('pack-bakery.json'));
  assert.equal(ok, true);
  assert.equal(pack.title, 'Bread basics');
  assert.deepEqual(
    pack.lessons.map((l) => l.lessonId),
    ['bk_l01', 'bk_l02'],
    'the unverified lesson is left out',
  );
  const first = pack.lessons[0].cards.map((c) => c.cardId);
  assert.deepEqual(first.slice(5, 8), ['bk_l01_c06', 'bk_l01_c09', 'bk_l01_c07'], 'array order, not id order');
  assert.equal(pack.lessons[0].needsReview, false);
  assert.equal(pack.lessons[1].needsReview, true);
  const types = new Set(pack.lessons.flatMap((l) => l.cards.map((c) => c.type)));
  assert.deepEqual([...types].sort(), ['cloze', 'desk', 'hotspot', 'match', 'mcq', 'multi', 'order', 'teach', 'variant']);
  for (const lesson of pack.lessons) {
    for (const card of lesson.cards) assert.equal(card.unshowable, undefined, `${card.cardId} can be shown`);
  }
});

test('a pack in the older shape reads, without checking engineMin or contentClass', async () => {
  const data = await loadFixture('pack-bakery-old.json');
  assert.equal(data.engineMin, '1.1');
  assert.equal('contentClass' in data, false);
  const { ok, pack } = readPack(data);
  assert.equal(ok, true);
  const cards = pack.lessons[0].cards;
  assert.equal(cards.length, 8);
  for (const card of cards) assert.equal(card.unshowable, undefined, `${card.cardId} can be shown`);
  const match = cards.find((c) => c.type === 'match');
  assert.deepEqual(
    match.pairs.map((p) => p.id),
    ['1', '2', '3'],
    'pairs without ids take their place in the file',
  );
  assert.equal(match.pairs[1].left, 'Couche');
});

test('fields the engine does not know are kept', async () => {
  const { pack } = readPack(await loadFixture('pack-bakery.json'));
  assert.equal(pack.fixtureNote, 'An unknown field, kept as read.');
  assert.equal(pack.lessons[0].objective, 'Say what raises a dough, and read a simple order.');
  assert.equal(pack.lessons[0].cards[1].authorNote, 'An unknown field, kept as read.');
  assert.equal(pack.lessons[0].cards[1].options[0].termRef, 'levain');
});

test('figures resolve from the pack; a teach card naming a missing one shows without it', async () => {
  const { pack } = readPack(await loadFixture('pack-bakery.json'));
  const [lesson1, lesson2] = pack.lessons;
  const withFigure = lesson1.cards[0].resolvedFigure;
  assert.equal(withFigure.layers.length, 1);
  assert.deepEqual(withFigure.viewBox, [0, 0, 300, 400]);
  assert.match(withFigure.alt, /^Cross-section/);
  assert.equal(lesson1.cards[2].resolvedFigure.layers.length, 3, 'stepped frames');
  const missing = lesson2.cards[0];
  assert.equal(missing.resolvedFigure, null);
  assert.equal(missing.unshowable, undefined);
  const { pack: old } = readPack(await loadFixture('pack-bakery-old.json'));
  assert.equal(old.lessons[0].cards[0].resolvedFigure, null, 'an older pack carries no figures');
});

test('pair ids: kept when given and unique, otherwise the place in the file', () => {
  assert.deepEqual(
    withPairIds([{ id: 'x' }, { id: 'y' }]).map((p) => p.id),
    ['x', 'y'],
  );
  assert.deepEqual(
    withPairIds([{ id: 'x' }, {}, { id: 'z' }]).map((p) => p.id),
    ['x', '2', 'z'],
  );
  assert.deepEqual(
    withPairIds([{ id: '2' }, {}]).map((p) => p.id),
    ['1', '2'],
    'a clash falls back to places',
  );
});

test('lessons sort by order, and lessons without cards are left out', () => {
  const card = { cardId: 'k1', type: 'teach', prompt: 'Read this.' };
  const { pack } = readPack({
    lessons: [
      { lessonId: 'b', order: 2, cards: [card] },
      { lessonId: 'none', order: 0, cards: [] },
      { lessonId: 'a', order: 1, cards: [card] },
      { lessonId: 'c', cards: [card] },
    ],
  });
  assert.deepEqual(
    pack.lessons.map((l) => l.lessonId),
    ['a', 'b', 'c'],
  );
});

test('a file that is not a pack gets a plain message', async () => {
  assert.deepEqual(readPack(null), { ok: false, message: MESSAGES.notAPack });
  assert.deepEqual(readPack([1, 2]), { ok: false, message: MESSAGES.notAPack });
  assert.deepEqual(readPack({ title: 'x' }), { ok: false, message: MESSAGES.notAPack });
  assert.deepEqual(readPack(await loadFixture('glossary.json')), { ok: false, message: MESSAGES.glossary });
  assert.deepEqual(readPack({ lessons: [] }), { ok: false, message: MESSAGES.noLessons });
});

test('a card that cannot be shown carries a plain reason instead of failing', () => {
  assert.equal(readCard({ type: 'flashcard' }).unshowable, MESSAGES.unknownType);
  assert.equal(readCard('nonsense').unshowable, MESSAGES.unknownType);
  assert.equal(readCard({ type: 'mcq', options: [{ id: 'a', text: 'A' }] }).unshowable, MESSAGES.incomplete);
  assert.equal(
    readCard({ type: 'mcq', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }).unshowable,
    MESSAGES.incomplete,
    'no correct option',
  );
  assert.equal(
    readCard({
      type: 'mcq',
      options: [
        { id: 'a', text: 'A', correct: true },
        { id: 'a', text: 'B' },
      ],
    }).unshowable,
    MESSAGES.sharedId,
  );
  const hotspot = {
    type: 'hotspot',
    figure: 'gone',
    regions: [
      { id: 'a', shape: { rect: [0, 0, 10, 10] }, correct: true },
      { id: 'b', shape: { rect: [20, 0, 10, 10] } },
    ],
  };
  assert.equal(readCard(hotspot, {}).unshowable, MESSAGES.figureMissing);
  assert.equal(readCard({ type: 'teach' }).unshowable, undefined);
});

test('viewBox and region shapes are read as numbers, and anything else is refused', () => {
  assert.deepEqual(parseViewBox("<svg viewBox='0 0 300 400'></svg>"), [0, 0, 300, 400]);
  assert.deepEqual(parseViewBox('<svg xmlns="x" viewBox="10,20,30,40">'), [10, 20, 30, 40]);
  assert.equal(parseViewBox('<svg width="10">'), null);
  assert.equal(parseViewBox("<svg viewBox='0 0 0 400'>"), null);
  assert.deepEqual(regionShape({ shape: { rect: [1, 2, 3, 4] } }), { kind: 'rect', x: 1, y: 2, width: 3, height: 4 });
  assert.deepEqual(regionShape({ shape: { circle: [5, 6, 7] } }), { kind: 'circle', cx: 5, cy: 6, r: 7 });
  assert.deepEqual(regionShape({ shape: { polygon: [0, 0, 10, 0, 5, 9] } }), {
    kind: 'polygon',
    points: [0, 0, 10, 0, 5, 9],
  });
  assert.equal(regionShape({ shape: { polygon: [0, 0, 10, 0] } }), null);
  assert.equal(regionShape({ shape: { rect: [1, 2, '3', 4] } }), null);
  assert.equal(regionShape({ shape: { star: [1] } }), null);
});
