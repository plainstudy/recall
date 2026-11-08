import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const loadFixture = async (name) =>
  JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

test('the invented fixture glossary is consistent, in the current shape', async () => {
  const glossary = await loadFixture('glossary.json');
  assert.equal(typeof glossary.engineMin, 'string', 'engineMin');
  const domains = new Set(glossary.domains.map((d) => d.id));
  const families = new Map(glossary.families.map((f) => [f.id, f]));
  const categories = new Set(glossary.categories.map((c) => c.id));
  assert.equal(domains.size, 1, 'one domain');
  assert.equal(families.size, 3, 'three families');
  assert.equal(categories.size, glossary.categories.length, 'category ids are unique');
  for (const family of families.values()) {
    assert.ok(domains.has(family.domain), `${family.id}: unknown domain`);
    assert.equal(typeof family.varianceRequired, 'boolean', `${family.id}: varianceRequired`);
  }

  const ids = new Set();
  for (const term of glossary.terms) {
    assert.ok(!ids.has(term.id), `duplicate id ${term.id}`);
    ids.add(term.id);
    assert.ok(domains.has(term.domain), `${term.id}: unknown domain`);
    assert.ok(families.has(term.family), `${term.id}: unknown family`);
    assert.ok(categories.has(term.category), `${term.id}: unknown category`);
    assert.equal(families.get(term.family).domain, term.domain, `${term.id}: family outside its domain`);
    assert.ok(['active', 'retired'].includes(term.status), `${term.id}: unknown status`);
    if (families.get(term.family).varianceRequired) {
      assert.ok(Array.isArray(term.variants), `${term.id}: variants missing`);
      assert.ok(Array.isArray(term.notTheSameAs), `${term.id}: notTheSameAs missing`);
    }
  }
  let linked = 0;
  for (const term of glossary.terms) {
    for (const related of term.relatedIds) assert.ok(ids.has(related), `${term.id}: ${related} does not resolve`);
    for (const near of term.notTheSameAs || []) {
      if (near.termId == null) continue;
      linked++;
      assert.ok(ids.has(near.termId), `${term.id}: near-miss ${near.termId} does not resolve`);
    }
  }
  assert.ok(linked > 0, 'at least one near-miss links to a term');
});

test('every term the fixture packs name resolves in the fixture glossary', async () => {
  const glossary = await loadFixture('glossary.json');
  const ids = new Set(glossary.terms.map((t) => t.id));
  for (const name of ['pack-bakery.json', 'pack-bakery-old.json']) {
    const pack = await loadFixture(name);
    for (const lesson of pack.lessons) {
      for (const card of lesson.cards) {
        const refs = [...(card.glossaryRefs || [])];
        if (card.termRef) refs.push(card.termRef);
        for (const list of [card.options, card.chips]) {
          for (const item of list || []) if (item.termRef) refs.push(item.termRef);
        }
        for (const ref of refs) assert.ok(ids.has(ref), `${name} ${card.cardId}: ${ref} does not resolve`);
      }
    }
  }
});
