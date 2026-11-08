import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MESSAGES, WARNINGS, checkFile, problemText, unsafeSvg } from '../../engine/validate.js';
import { ctxFor, fixture, installedWith, nothingInstalled } from './fixtures.mjs';

const pack = () => fixture('pack-bakery.json');
const glossary = () => fixture('glossary.json');
const withGlossary = (extra = {}) => ctxFor(installedWith({ glossary: glossary(), ...extra }));
const cardIn = (p, id) => p.lessons.flatMap((l) => l.cards).find((c) => c.cardId === id);
const lessonIn = (p, id) => p.lessons.find((l) => l.lessonId === id);

function expectProblem(result, item, message) {
  assert.equal(result.ok, false, 'refused');
  assert.equal(result.stop, false, 'not one of the first three checks');
  const found = result.problems.some((p) => p.item === item && p.message === message);
  assert.ok(found, `expected "${item}: ${message}" in ${JSON.stringify(result.problems, null, 1)}`);
}

const expectStop = (result, message) => assert.deepEqual(result, { ok: false, stop: true, problems: [{ item: '', message }], warnings: [] });

test('every fixture in the current shape passes', () => {
  assert.equal(checkFile('glossary', glossary(), ctxFor(nothingInstalled())).ok, true);
  assert.equal(checkFile('glossary', fixture('glossary-next.json'), ctxFor(nothingInstalled())).ok, true);
  assert.equal(checkFile('track', fixture('track-bakery.json'), ctxFor(nothingInstalled())).ok, true);
  assert.equal(checkFile('bundle', fixture('bundle-bakery.json'), ctxFor(nothingInstalled())).ok, true);
  assert.equal(checkFile('pack', pack(), withGlossary()).ok, true);
  assert.equal(checkFile('pack', fixture('pack-bakery-next.json'), withGlossary()).ok, true);
});

test('the older formats are refused first, before engineMin, so the message is never about the engine', () => {
  const old = fixture('pack-bakery-old.json');
  assert.equal(old.engineMin, '1.1');
  expectStop(checkFile('pack', old, withGlossary()), MESSAGES.olderPack);
  const noDomains = glossary();
  delete noDomains.domains;
  noDomains.engineMin = '9.0';
  expectStop(checkFile('glossary', noDomains, ctxFor(nothingInstalled())), MESSAGES.olderGlossary);
  const partFamily = glossary();
  partFamily.terms[0].partFamily = 'leavening';
  expectStop(checkFile('glossary', partFamily, ctxFor(nothingInstalled())), MESSAGES.olderGlossary);
  const bundle = fixture('bundle-bakery.json');
  delete bundle.packs[0].contentClass;
  expectStop(checkFile('bundle', bundle, ctxFor(nothingInstalled())), MESSAGES.olderPart('pack bakery_basics'));
});

test('a file needing a newer engine is refused with the plain message (test 17)', () => {
  const p = pack();
  p.engineMin = '0.3';
  const result = checkFile('pack', p, withGlossary());
  expectStop(result, 'This pack needs engine 0.3.0 or later. This app is 0.2.0. Restart the app when it has updated.');
  const g = glossary();
  g.engineMin = '1.0.0';
  expectStop(checkFile('glossary', g, ctxFor(nothingInstalled())), MESSAGES.engineTooOld('glossary', '1.0.0', '0.2.0'));
  const t = fixture('track-bakery.json');
  delete t.engineMin;
  expectStop(checkFile('track', t, ctxFor(nothingInstalled())), MESSAGES.noEngineMin('track'));
  const b = fixture('bundle-bakery.json');
  b.track.engineMin = '0.2.1';
  expectStop(checkFile('bundle', b, ctxFor(nothingInstalled())), MESSAGES.engineTooOld("bundle's track", '0.2.1', '0.2.0'));
  // engineMin at the engine's own version is fine, and a missing part counts as 0.
  const ok = pack();
  ok.engineMin = '0.2';
  assert.equal(checkFile('pack', ok, withGlossary()).ok, true);
});

test('versions are checked against what is installed', () => {
  const installedPack = pack();
  const ctx = withGlossary({ packs: [installedPack] });
  expectStop(checkFile('pack', pack(), ctx), MESSAGES.alreadyInstalled('pack', '1.0'));
  const older = pack();
  older.packVersion = '0.9';
  expectStop(checkFile('pack', older, ctx), MESSAGES.older('pack', '0.9', '1.0'));
  assert.equal(checkFile('pack', fixture('pack-bakery-next.json'), ctx).ok, true, 'a newer version goes ahead');
  const badVersion = pack();
  badVersion.packVersion = '1';
  expectStop(checkFile('pack', badVersion, withGlossary()), MESSAGES.badVersion('pack'));

  const next = fixture('glossary-next.json');
  const g12 = ctxFor(installedWith({ glossary: next }));
  expectStop(checkFile('glossary', glossary(), g12), MESSAGES.older('glossary', '1.1', '1.2'));
  expectStop(checkFile('glossary', fixture('glossary-next.json'), g12), MESSAGES.alreadyInstalled('glossary', '1.2'));

  const track = fixture('track-bakery.json');
  const t = ctxFor(installedWith({ track }));
  expectStop(checkFile('track', fixture('track-bakery.json'), t), MESSAGES.alreadyInstalled('track', '1.0'));
  const otherTrack = { ...fixture('track-bakery.json'), trackId: 'pastry-cook', trackVersion: '0.1' };
  assert.equal(checkFile('track', otherTrack, t).ok, true, 'a different track has no version to compare');
});

test('the same bundle again is already installed, unless one of its parts has gone', () => {
  const bundle = fixture('bundle-bakery.json');
  const details = { bundleId: 'bakery', bundleVersion: '1.0' };
  const full = installedWith({ bundle: details, glossary: bundle.glossary, track: bundle.track, packs: bundle.packs });
  expectStop(checkFile('bundle', fixture('bundle-bakery.json'), ctxFor(full)), MESSAGES.alreadyInstalled('bundle', '1.0'));
  const removed = installedWith({ bundle: details, glossary: bundle.glossary, track: bundle.track, packs: [] });
  assert.equal(checkFile('bundle', fixture('bundle-bakery.json'), ctxFor(removed)).ok, true);
  const older = fixture('bundle-bakery.json');
  older.bundleVersion = '0.9';
  expectStop(checkFile('bundle', older, ctxFor(full)), MESSAGES.older('bundle', '0.9', '1.0'));
  // A part older than the one installed is no refusal: the newer one stays. The same
  // version is fine too.
  const newerGlossary = installedWith({ glossary: fixture('glossary-next.json') });
  assert.equal(checkFile('bundle', fixture('bundle-bakery.json'), ctxFor(newerGlossary)).ok, true);
  const sameGlossary = installedWith({ glossary: glossary() });
  assert.equal(checkFile('bundle', fixture('bundle-bakery.json'), ctxFor(sameGlossary)).ok, true);
  const newerPack = installedWith({ glossary: glossary(), packs: [fixture('pack-bakery-next.json')] });
  assert.equal(checkFile('bundle', fixture('bundle-bakery.json'), ctxFor(newerPack)).ok, true);
});

test("a bundle kept with a newer glossary still refuses what doesn't fit it", () => {
  // A newer glossary that, unusually, lacks a term the bundle's pack names.
  const newer = fixture('glossary-next.json');
  newer.terms = newer.terms.filter((t) => t.id !== 'scoring');
  newer.terms.forEach((t) => (t.relatedIds = (t.relatedIds || []).filter((id) => id !== 'scoring')));
  const result = checkFile('bundle', fixture('bundle-bakery.json'), ctxFor(installedWith({ glossary: newer })));
  expectProblem(result, 'pack bakery_basics, card bk_l02_c06', MESSAGES.unknownTerm('scoring'));
  // A broken part is refused even when a newer one is installed.
  const broken = fixture('bundle-bakery.json');
  broken.glossary.terms[0].domain = 'brewing';
  const kept = checkFile('bundle', broken, ctxFor(installedWith({ glossary: fixture('glossary-next.json') })));
  expectProblem(kept, 'glossary, term levain', MESSAGES.unknownRef('domain', 'brewing'));
});

// [what is wrong, how to make it so, the item named, the message]
const PACK_RULES = [
  ['a title missing', (p) => delete p.title, 'the pack', MESSAGES.missing('title')],
  ['a class other than public or private', (p) => (p.contentClass = 'secret'), 'the pack', MESSAGES.badClass],
  ['no order', (p) => delete p.order, 'the pack', MESSAGES.noOrder],
  ['a packId in capitals', (p) => (p.packId = 'Bakery'), 'the pack', MESSAGES.badId('packId')],
  ['no lessons', (p) => (p.lessons = []), 'the pack', MESSAGES.noLessons],
  ['a lesson id used twice', (p) => (p.lessons[1].lessonId = 'bk_l01'), 'lesson bk_l01', MESSAGES.idTwice('lesson', 'bk_l01')],
  ['a card id used twice', (p) => (cardIn(p, 'bk_l01_c03').cardId = 'bk_l01_c02'), 'card bk_l01_c02', MESSAGES.idTwice('card', 'bk_l01_c02')],
  ['a lesson without its status', (p) => delete p.lessons[0].verification, 'lesson bk_l01', MESSAGES.badStatus],
  ['a lesson without cards', (p) => (p.lessons[2].cards = []), 'lesson bk_l03', MESSAGES.noCards],
  ['a prerequisite that comes later', (p) => (p.lessons[0].prerequisites = ['bk_l02']), 'lesson bk_l01', MESSAGES.badPrerequisite('bk_l02')],
  ['a prerequisite that is nowhere', (p) => (p.lessons[1].prerequisites = ['zz_l09']), 'lesson bk_l02', MESSAGES.badPrerequisite('zz_l09')],
  ['an unknown type', (p) => (cardIn(p, 'bk_l01_c02').type = 'flashcard'), 'card bk_l01_c02', MESSAGES.unknownType('flashcard')],
  ['a testable card without srsKey', (p) => delete cardIn(p, 'bk_l01_c02').srsKey, 'card bk_l01_c02', MESSAGES.noSrsKey('mcq')],
  ['a teach card with srsKey', (p) => (cardIn(p, 'bk_l01_c01').srsKey = 'atom.x.y'), 'card bk_l01_c01', MESSAGES.teachSrsKey],
  ['an srsKey of the wrong shape', (p) => (cardIn(p, 'bk_l01_c02').srsKey = 'levain'), 'card bk_l01_c02', MESSAGES.badSrsKey],
  ['a card without a prompt', (p) => delete cardIn(p, 'bk_l01_c02').prompt, 'card bk_l01_c02', MESSAGES.missing('prompt')],
  ['an mcq with two options', (p) => cardIn(p, 'bk_l01_c02').options.splice(2), 'card bk_l01_c02', MESSAGES.badCount('mcq', 'options', 3, 4, 2)],
  ['an mcq with two right answers', (p) => (cardIn(p, 'bk_l01_c07').options.forEach((o) => (o.correct = true))), 'card bk_l01_c07', MESSAGES.oneCorrect('mcq', 'option', 4)],
  ['a desk card with five options', (p) => cardIn(p, 'bk_l01_c08').options.push({ id: 'x', text: 'X', correct: false }, { id: 'y', text: 'Y', correct: false }), 'card bk_l01_c08', MESSAGES.badCount('desk', 'options', 3, 4, 5)],
  ['a multi with nothing right', (p) => cardIn(p, 'bk_l01_c06').options.forEach((o) => (o.correct = false)), 'card bk_l01_c06', MESSAGES.someCorrect('multi')],
  ['a variant option without its note', (p) => delete cardIn(p, 'bk_l02_c05').options[0].note, 'card bk_l02_c05', MESSAGES.badEntry('Option', 1, 'an id, text, correct and a note')],
  ['a variant card without its term', (p) => delete cardIn(p, 'bk_l02_c05').term, 'card bk_l02_c05', MESSAGES.variantTerm],
  ['two options sharing an id', (p) => (cardIn(p, 'bk_l01_c07').options[1].id = cardIn(p, 'bk_l01_c07').options[0].id), 'card bk_l01_c07', MESSAGES.sharedId('options', cardIn(pack(), 'bk_l01_c07').options[0].id)],
  ['an option without correct', (p) => delete cardIn(p, 'bk_l01_c02').options[1].correct, 'card bk_l01_c02', MESSAGES.badEntry('Option', 2, 'an id, text and correct')],
  ['order positions that skip', (p) => (cardIn(p, 'bk_l01_c09').items[0].position = 9), 'card bk_l01_c09', MESSAGES.positions(4)],
  ['an order card with two items', (p) => cardIn(p, 'bk_l01_c09').items.splice(2), 'card bk_l01_c09', MESSAGES.badCount('order', 'items', 3, 6, 2)],
  ['a match card with two pairs', (p) => cardIn(p, 'bk_l01_c05').pairs.splice(2), 'card bk_l01_c05', MESSAGES.badCount('match', 'pairs', 3, 5, 2)],
  ['a match pair without its right side', (p) => delete cardIn(p, 'bk_l02_c03').pairs[0].right, 'card bk_l02_c03', MESSAGES.badEntry('Pair', 1, 'a left and a right')],
  ['a cloze without its gap', (p) => (cardIn(p, 'bk_l01_c04').prompt = 'No gap here.'), 'card bk_l01_c04', MESSAGES.clozeGap(0)],
  ['a cloze with two gaps', (p) => (cardIn(p, 'bk_l01_c04').prompt = 'A ___ and a ___.'), 'card bk_l01_c04', MESSAGES.clozeGap(2)],
  ['a cloze with five chips', (p) => cardIn(p, 'bk_l01_c04').chips.push({ id: 'x', text: 'x', correct: false }, { id: 'y', text: 'y', correct: false }), 'card bk_l01_c04', MESSAGES.badCount('cloze', 'chips', 3, 4, 5)],
  ['a hotspot without a figure', (p) => delete cardIn(p, 'bk_l02_c02').figure, 'card bk_l02_c02', MESSAGES.hotspotNoFigure],
  ['a hotspot whose figure is not carried', (p) => (cardIn(p, 'bk_l02_c02').figure = 'fig_absent'), 'card bk_l02_c02', MESSAGES.hotspotFigureMissing('fig_absent')],
  ['a hotspot on a stepped figure', (p) => (cardIn(p, 'bk_l02_c02').figure = 'fig_shaping_steps'), 'card bk_l02_c02', MESSAGES.hotspotFrames],
  ['a hotspot region without a shape', (p) => (cardIn(p, 'bk_l02_c02').regions[0].shape = { square: [1] }), 'card bk_l02_c02', MESSAGES.badEntry('Region', 1, 'a shape: a rect, circle or polygon')],
  ['a hotspot with one region', (p) => cardIn(p, 'bk_l02_c02').regions.splice(1), 'card bk_l02_c02', MESSAGES.badCount('hotspot', 'regions', 2, 7, 1)],
  ['frames on a card that is not teach', (p) => (cardIn(p, 'bk_l01_c02').figure = 'fig_shaping_steps'), 'card bk_l01_c02', MESSAGES.framesOnlyTeach],
  ['a desk artifact of an unknown kind', (p) => (cardIn(p, 'bk_l01_c08').artifact = { kind: 'memo', text: 'x' }), 'card bk_l01_c08', MESSAGES.badArtifact],
  ['a glossary reference that does not resolve', (p) => (cardIn(p, 'bk_l01_c02').glossaryRefs = ['levain', 'crumb']), 'card bk_l01_c02', MESSAGES.unknownTerm('crumb')],
  ['an option naming an unknown term', (p) => (cardIn(p, 'bk_l01_c02').options[0].termRef = 'crust'), 'card bk_l01_c02', MESSAGES.unknownTerm('crust')],
  ['a variant card naming an unknown term', (p) => (cardIn(p, 'bk_l02_c05').termRef = 'basket'), 'card bk_l02_c05', MESSAGES.unknownTerm('basket')],
  ['a figure without alt text', (p) => delete p.figures.fig_loaf_section.alt, 'figure fig_loaf_section', MESSAGES.badFigure],
  ['a figure with a script', (p) => (p.figures.fig_loaf_section.svg = "<svg viewBox='0 0 10 10'><script>1</script></svg>"), 'figure fig_loaf_section', MESSAGES.unsafeFigure],
  ['a frame loading from outside', (p) => (p.figures.fig_shaping_steps.frames[1] = "<svg><image href='https://example.com/x.png'/></svg>"), 'figure fig_shaping_steps', MESSAGES.unsafeFigure],
];

test('every pack rule refuses with its own message, naming the item', async (t) => {
  for (const [what, mutate, item, message] of PACK_RULES) {
    await t.test(what, () => {
      const p = pack();
      mutate(p);
      expectProblem(checkFile('pack', p, withGlossary()), item, message);
    });
  }
});

test('ids may not clash with another installed pack', () => {
  const other = { ...pack(), packId: 'bakery_more', title: 'More bread' };
  const ctx = withGlossary({ packs: [other] });
  const result = checkFile('pack', pack(), ctx);
  expectProblem(result, 'lesson bk_l01', MESSAGES.idElsewhere('lesson', 'bk_l01', 'the pack "More bread"'));
  expectProblem(result, 'card bk_l01_c01', MESSAGES.idElsewhere('card', 'bk_l01_c01', 'the pack "More bread"'));
  // The pack's own earlier version is no clash.
  assert.equal(checkFile('pack', fixture('pack-bakery-next.json'), withGlossary({ packs: [pack()] })).ok, true);
});

test('a pack naming terms needs a glossary installed first', () => {
  expectProblem(checkFile('pack', pack(), ctxFor(nothingInstalled())), 'the pack', MESSAGES.noGlossary);
  const plain = fixture('pack-bakery-next.json');
  for (const lesson of plain.lessons) {
    for (const card of lesson.cards) {
      delete card.glossaryRefs;
      delete card.termRef;
      for (const entry of [...(card.options || []), ...(card.chips || [])]) delete entry.termRef;
    }
  }
  assert.equal(checkFile('pack', plain, ctxFor(nothingInstalled())).ok, true, 'a pack naming no terms needs none');
});

test('every problem past the first three is listed, in file order', () => {
  const p = pack();
  p.contentClass = 'secret';
  cardIn(p, 'bk_l01_c04').prompt = 'No gap.';
  cardIn(p, 'bk_l01_c02').type = 'flashcard';
  cardIn(p, 'bk_l02_c06').chips = [];
  const result = checkFile('pack', p, withGlossary());
  assert.deepEqual(
    result.problems.map((x) => x.item),
    ['the pack', 'card bk_l01_c02', 'card bk_l01_c04', 'card bk_l02_c06'],
  );
  assert.equal(problemText(result.problems[1]), `Card bk_l01_c02: ${MESSAGES.unknownType('flashcard')}`);
  assert.equal(problemText(result.problems[0]), 'The pack: contentClass must be "public" or "private".');
});

test('accepted with warnings: a teach figure not carried, and the needs-review count', () => {
  const result = checkFile('pack', pack(), withGlossary());
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, [
    { item: 'card bk_l02_c01', message: WARNINGS.figureNotInPack('fig_not_in_pack') },
    { item: '', message: WARNINGS.needsReview(1, 'lesson') },
  ]);
});

test('figures are refused when anything in them could run or load from outside', () => {
  const unsafe = [
    "<svg><script>alert(1)</script></svg>",
    "<svg><foreignObject><div/></foreignObject></svg>",
    "<svg onload='x()'></svg>",
    "<svg><rect onclick = \"x()\"/></svg>",
    "<svg><use href='other.svg#a'/></svg>",
    '<svg><use xlink:href="https://example.com/a.svg#b"/></svg>',
    "<svg><rect style='fill:url(https://example.com/x)'/></svg>",
    "<svg><style>@import 'x.css';</style></svg>",
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///x">]><svg>&x;</svg>',
    "<svg><image src='x.png'/></svg>",
  ];
  for (const svg of unsafe) assert.ok(unsafeSvg(svg), svg);
  const safe = [
    "<svg viewBox='0 0 10 10'><rect width='10' height='10' fill='#fff'/></svg>",
    "<svg><defs><linearGradient id='g'/></defs><rect fill='url(#g)'/><use href='#g'/></svg>",
    '<svg><text>Turn on the oven = done</text></svg>',
  ];
  for (const svg of safe) assert.ok(!unsafeSvg(svg), svg);
});

// [what is wrong, how to make it so, the item named, the message]
const GLOSSARY_RULES = [
  ['a term id used twice', (g) => (g.terms[1].id = 'levain'), 'term levain', MESSAGES.idTwice('term', 'levain')],
  ['a domain id used twice', (g) => g.domains.push({ id: 'bread-baking', name: 'Again' }), 'domain bread-baking', MESSAGES.idTwice('domain', 'bread-baking')],
  ['a term in an unknown domain', (g) => (g.terms[0].domain = 'brewing'), 'term levain', MESSAGES.unknownRef('domain', 'brewing')],
  ['a term in an unknown family', (g) => (g.terms[0].family = 'kneading'), 'term levain', MESSAGES.unknownRef('family', 'kneading')],
  ['a term in an unknown category', (g) => (g.terms[0].category = 'gadget'), 'term levain', MESSAGES.unknownRef('category', 'gadget')],
  ['a related term that does not exist', (g) => (g.terms[0].relatedIds = ['crumb']), 'term levain', MESSAGES.unknownRef('related term', 'crumb')],
  ['a near-miss linking nowhere', (g) => (g.terms[0].notTheSameAs[0].termId = 'crumb'), 'term levain', MESSAGES.unknownRef('termId', 'crumb')],
  ['a family in an unknown domain', (g) => (g.families[0].domain = 'brewing'), 'family leavening', MESSAGES.unknownRef('domain', 'brewing')],
  [
    'a family outside its domain',
    (g) => {
      g.domains.push({ id: 'pastry', name: 'Pastry' });
      g.terms[0].domain = 'pastry';
    },
    'term levain',
    MESSAGES.familyDomain('leavening', 'pastry'),
  ],
  ['a term without its definition', (g) => delete g.terms[2].definition, 'term banneton', MESSAGES.missing('definition')],
  ['a status that is neither active nor retired', (g) => (g.terms[0].status = 'gone'), 'term levain', MESSAGES.badTermStatus],
  ['an unknown verification', (g) => (g.terms[0].verification = 'checked'), 'term levain', MESSAGES.badVerification],
  ['no terms', (g) => (g.terms = []), 'the glossary', MESSAGES.noTerms],
];

test('every glossary rule refuses with its own message, naming the item', async (t) => {
  for (const [what, mutate, item, message] of GLOSSARY_RULES) {
    await t.test(what, () => {
      const g = glossary();
      mutate(g);
      expectProblem(checkFile('glossary', g, ctxFor(nothingInstalled())), item, message);
    });
  }
});

test('a glossary update never deletes a term, and the installed packs still resolve (test 30)', () => {
  const next = fixture('glossary-next.json');
  next.terms = next.terms.filter((t) => t.id !== 'poolish');
  const ctx = ctxFor(installedWith({ glossary: glossary(), packs: [pack()] }));
  const result = checkFile('glossary', next, ctx);
  expectProblem(result, 'the glossary', MESSAGES.deletedTerm('poolish'));
  expectProblem(result, 'the glossary', MESSAGES.installedRef('Bread basics', 'bk_l01_c05', 'poolish'));
  // A retired term still resolves by its id: the installed pack names it, and passes.
  assert.equal(checkFile('glossary', fixture('glossary-next.json'), ctx).ok, true);
  assert.equal(fixture('glossary-next.json').terms.find((t) => t.id === 'couche').status, 'retired');
});

test('a family term without its variance keys is accepted, with a warning', () => {
  const g = glossary();
  delete g.terms[0].variants;
  const result = checkFile('glossary', g, ctxFor(nothingInstalled()));
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, [{ item: 'term levain', message: WARNINGS.varianceUnchecked }]);
});

test('a track lists at least one pack, each once', () => {
  const empty = fixture('track-bakery.json');
  empty.packs = [];
  expectProblem(checkFile('track', empty, ctxFor(nothingInstalled())), 'the track', MESSAGES.noTrackPacks);
  const twice = fixture('track-bakery.json');
  twice.packs = ['bakery_basics', 'bakery_more', 'bakery_basics'];
  expectProblem(checkFile('track', twice, ctxFor(nothingInstalled())), 'the track', MESSAGES.packTwice('bakery_basics'));
});

test("a bundle's parts are checked together", () => {
  // Its pack's terms resolve in its own glossary, with nothing installed.
  assert.equal(checkFile('bundle', fixture('bundle-bakery.json'), ctxFor(nothingInstalled())).ok, true);
  const missingTerm = fixture('bundle-bakery.json');
  missingTerm.glossary.terms = missingTerm.glossary.terms.filter((t) => t.id !== 'scoring');
  missingTerm.glossary.terms.forEach((t) => (t.relatedIds = []));
  const result = checkFile('bundle', missingTerm, ctxFor(nothingInstalled()));
  expectProblem(result, 'pack bakery_basics, card bk_l02_c06', MESSAGES.unknownTerm('scoring'));
  const twice = fixture('bundle-bakery.json');
  twice.packs.push(fixture('pack-bakery.json'));
  expectProblem(checkFile('bundle', twice, ctxFor(nothingInstalled())), 'the bundle', MESSAGES.packInBundleTwice('bakery_basics'));
  const free = fixture('bundle-bakery.json');
  free.ai = { models: [{ id: 'maker/model:free', jobs: ['why'], private: true }] };
  expectProblem(checkFile('bundle', free, ctxFor(nothingInstalled())), 'the bundle', MESSAGES.freePrivate('maker/model:free'));
  const prefix = fixture('bundle-bakery.json');
  prefix.reportPrefix = 'Bakery School';
  expectProblem(checkFile('bundle', prefix, ctxFor(nothingInstalled())), 'the bundle', MESSAGES.badPrefix);
  const noTrack = fixture('bundle-bakery.json');
  delete noTrack.track;
  expectProblem(checkFile('bundle', noTrack, ctxFor(nothingInstalled())), 'the bundle', MESSAGES.notPart('track'));
  const brokenTrack = fixture('bundle-bakery.json');
  brokenTrack.track.packs = [];
  expectProblem(checkFile('bundle', brokenTrack, ctxFor(nothingInstalled())), 'track, the track', MESSAGES.noTrackPacks);
});
