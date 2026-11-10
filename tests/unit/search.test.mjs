import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRequested, listTerms, nameMatches, requestTerm, searchGlossary, termView, typedWords, wordsOf } from '../../engine/search.js';
import { newProgress } from '../../engine/progress.js';
import { withReportMarks } from '../../engine/report.js';
import { clockAt } from './clock.mjs';
import { fixtureText } from './fixtures.mjs';
import { seededRandom } from './seeded.mjs';

const glossary = JSON.parse(fixtureText('glossary-search.json'));
const found = (typed, options) => searchGlossary(glossary, typed, options).map((r) => `${r.kind}: ${r.name}${r.kind === 'term' ? '' : ` → ${r.term.term}`}`);

test('names are matched ignoring case, accents and punctuation', () => {
  assert.deepEqual(wordsOf('B/P'), ['b', 'p', 'bp']);
  assert.deepEqual(wordsOf("Baker's percentage"), ['baker', 's', 'bakers', 'percentage']);
  assert.deepEqual(typedWords('  PÂTE   fermentée! '), ['pate', 'fermentee']);
  assert.ok(nameMatches('Pâte fermentée', typedWords('PATE')));
  assert.deepEqual(found('pâte'), ['term: Pâte fermentée', 'near-miss: Pâte fermentée → Poolish']);
  assert.deepEqual(found('PATE FERM'), found('pâte ferm'));
  assert.deepEqual(found('bakers'), ["expansion: Baker's percentage → B/P"]);
});

test('every typed word must match the start of a word, in any order', () => {
  assert.deepEqual(found('fermentée pâte').slice(0, 1), ['term: Pâte fermentée']);
  assert.deepEqual(found('ate'), []);
  assert.deepEqual(found('basket proof'), ['term: Proofing basket']);
  assert.deepEqual(found('proof basket rye'), []);
});

test('an abbreviation is found with or without its punctuation', () => {
  for (const typed of ['B/P', 'b/p', 'BP', 'bp', 'b p']) assert.deepEqual(found(typed)[0], 'term: B/P', typed);
  assert.deepEqual(found('PR')[0], 'term: P/R');
});

test('results run: exact name, then terms, variants, near-misses, expansions, each A to Z', () => {
  assert.deepEqual(found('proof'), [
    'term: Proof',
    'term: Proofing basket',
    'variant: Proof cabinet → Retarder',
    'near-miss: Proofing cloth → Proof',
    'expansion: Proof rate → P/R',
  ]);
  // An exact name comes first whatever its kind.
  assert.deepEqual(found('banneton'), ['variant: Banneton → Proofing basket']);
  assert.deepEqual(found('proof rate')[0], 'expansion: Proof rate → P/R');
  assert.deepEqual(found('old dough'), ['variant: Old dough → Pâte fermentée']);
  // A near-miss result carries its warning and its reason.
  const near = searchGlossary(glossary, 'proofing cloth')[0];
  assert.equal(near.warning, 'Proofing cloth: not the same as Proof.');
  assert.equal(near.why, 'The cloth is what the dough rests on, not the rise itself.');
  const variant = searchGlossary(glossary, 'final rise')[0];
  assert.deepEqual([variant.kind, variant.usedBy, variant.term.id], ['variant', 'Most home bakers', 'proof']);
});

test('retired terms are hidden unless shown; unverified terms never appear', () => {
  assert.deepEqual(found('couche'), []);
  assert.deepEqual(found('couche', { showRetired: true }), ['term: Couche']);
  assert.deepEqual(found('proof box'), []);
  assert.deepEqual(found('proof box', { showRetired: true }), []);
  assert.ok(!listTerms(glossary, { showRetired: true }).some((t) => t.id === 'secret-box'));
  assert.deepEqual(found(''), []);
  assert.deepEqual(found(' / '), []);
});

test("the file's own domains, families and categories filter the results and the list", () => {
  assert.deepEqual(found('c', { domain: 'pastry' }), ['term: Croissant']);
  assert.deepEqual(found('c', { family: 'laminating' }), ['term: Croissant']);
  assert.deepEqual(
    listTerms(glossary, { category: 'measure' }).map((t) => t.term),
    ['B/P', 'P/R'],
  );
  assert.deepEqual(
    listTerms(glossary).map((t) => t.term),
    ['Autolyse', 'B/P', 'Croissant', 'P/R', 'Pâte fermentée', 'Poolish', 'Proof', 'Proofing basket', 'Retarder'],
  );
});

test('a term on its own screen: everything at once, with its markers', () => {
  const proof = termView(glossary, 'proof');
  assert.equal(proof.name, 'Proof');
  assert.equal(proof.definition, 'The last rise of a shaped dough before it is baked.');
  assert.equal(proof.spoken, 'proof, as in proving the dough');
  assert.deepEqual(proof.variants, [{ name: 'Final rise', usedBy: 'Most home bakers', note: 'Said of the dough, never of the oven.' }]);
  assert.deepEqual(proof.nearMisses, [{ name: 'Proofing cloth', warning: 'Proofing cloth: not the same as Proof.', why: 'The cloth is what the dough rests on, not the rise itself.', termId: null }]);
  // An unverified related term isn't shown.
  assert.deepEqual(proof.related, [{ id: 'proofing-basket', name: 'Proofing basket' }]);
  assert.deepEqual([proof.domain, proof.family, proof.category], ['Bread baking', 'Leavening', 'Technique']);
  assert.deepEqual(proof.markers, { needsReview: false, variantsUnchecked: false, retired: false });
  assert.equal(termView(glossary, 'poolish').markers.needsReview, true);
  assert.equal(termView(glossary, 'poolish').nearMisses[0].termId, 'pate-fermentee');
  assert.equal(termView(glossary, 'autolyse').markers.variantsUnchecked, true);
  assert.equal(termView(glossary, 'bp').markers.variantsUnchecked, false, 'no family, so no variance check');
  assert.equal(termView(glossary, 'bp').expansion, "Baker's percentage");
  assert.equal(termView(glossary, 'couche').markers.retired, true);
  assert.equal(termView(glossary, 'secret-box'), null);
  assert.equal(termView(glossary, 'nothing-here'), null);
});

test('acceptance test 34, the request: stored once, until a report carries it', () => {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  const progress = newProgress({ name: 'Sam' }, clock, '1.0.0', seededRandom(1));
  const once = requestTerm(progress, '  rye   flour ', '2026-11-15');
  assert.deepEqual(once.termRequests, [{ text: 'rye flour', on: '2026-11-15', reportedOn: null }]);
  assert.equal(isRequested(once, 'Rye-flour'), true);
  assert.equal(requestTerm(once, 'RYE FLOUR', '2026-11-16'), once, 'the same request is already waiting');
  assert.equal(requestTerm(progress, '   ', '2026-11-15'), progress);
  // Once a report has carried it, the same words can be asked for again.
  const reported = withReportMarks(once, '2026-11-20');
  assert.equal(isRequested(reported, 'rye flour'), false);
  assert.equal(requestTerm(reported, 'rye flour', '2026-11-21').termRequests.length, 2);
});
