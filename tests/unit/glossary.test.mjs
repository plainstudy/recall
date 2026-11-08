import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changesText, filterTerms, glossaryChanges, groupTerms, taxonomy, termById } from '../../engine/glossary.js';
import { fixture } from './fixtures.mjs';

const ids = (terms) => terms.map((t) => t.id);

test('an update is counted by comparing entries: new, changed and retired (test 30)', () => {
  const changes = glossaryChanges(fixture('glossary.json'), fixture('glossary-next.json'));
  assert.deepEqual(changes, { new: 1, changed: 1, retired: 1 });
  assert.equal(changesText(changes), 'with 1 new, 1 changed and 1 retired');
  assert.deepEqual(glossaryChanges(null, fixture('glossary.json')), { new: 6, changed: 0, retired: 0 });
  assert.deepEqual(glossaryChanges(fixture('glossary.json'), fixture('glossary.json')), { new: 0, changed: 0, retired: 0 });
  // Key order is not a change; any field's value is.
  const reordered = fixture('glossary.json');
  reordered.terms[0] = Object.fromEntries(Object.entries(reordered.terms[0]).reverse());
  assert.equal(glossaryChanges(fixture('glossary.json'), reordered).changed, 0);
  const respelled = fixture('glossary.json');
  respelled.terms[4].variants[0].usedBy = 'Bakers';
  assert.equal(glossaryChanges(fixture('glossary.json'), respelled).changed, 1);
});

test('a retired term still resolves by its id, and is hidden unless asked for (test 30)', () => {
  const next = fixture('glossary-next.json');
  assert.equal(termById(next, 'couche').status, 'retired');
  assert.ok(!ids(filterTerms(next)).includes('couche'));
  assert.ok(ids(filterTerms(next, { showRetired: true })).includes('couche'));
});

test('filters and groups come from the file, so nothing in the engine names one (test 31)', () => {
  const next = fixture('glossary-next.json');
  assert.deepEqual(taxonomy(next).domains.map((d) => d.id), ['bread-baking', 'pastry']);
  assert.deepEqual(ids(filterTerms(next, { domain: 'pastry' })), ['lamination']);
  assert.deepEqual(ids(filterTerms(next, { domain: 'bread-baking' })), ['levain', 'poolish', 'banneton', 'scoring', 'oven-spring']);
  assert.deepEqual(ids(filterTerms(next, { family: 'leavening' })), ['levain', 'poolish']);
  assert.deepEqual(ids(filterTerms(next, { category: 'technique' })), ['scoring', 'oven-spring', 'lamination']);
  assert.deepEqual(
    groupTerms(next, 'domain').map((g) => [g.name, ids(g.terms)]),
    [
      ['Bread baking', ['levain', 'poolish', 'banneton', 'scoring', 'oven-spring']],
      ['Pastry', ['lamination']],
    ],
  );
  assert.deepEqual(
    groupTerms(next, 'family').map((g) => g.name),
    ['Leavening', 'Shaping', 'Oven work', 'Laminating'],
  );
  assert.deepEqual(
    groupTerms(next, 'category', { showRetired: true }).map((g) => [g.id, g.terms.length]),
    [
      ['ingredient', 2],
      ['tool', 2],
      ['technique', 3],
    ],
  );
});

test('unverified terms are never shown, and terms with no family group last', () => {
  const g = fixture('glossary-next.json');
  g.terms[0].verification = 'unverified';
  g.terms[1].family = null;
  assert.ok(!ids(filterTerms(g, { showRetired: true })).includes('levain'));
  const groups = groupTerms(g, 'family');
  assert.deepEqual(groups.at(-1), { id: null, name: null, terms: [g.terms[1]] });
});
