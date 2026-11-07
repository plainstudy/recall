import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const loadFixture = async () =>
  JSON.parse(await readFile(new URL('../fixtures/glossary.json', import.meta.url), 'utf8'));

test('the invented fixture glossary is consistent', async () => {
  const glossary = await loadFixture();
  const domains = new Set(glossary.domains.map((d) => d.id));
  const families = new Map(glossary.families.map((f) => [f.id, f]));
  assert.equal(domains.size, 1, 'one domain');
  assert.equal(families.size, 3, 'three families');
  for (const family of families.values()) assert.ok(domains.has(family.domain), `${family.id}: unknown domain`);

  const ids = new Set();
  for (const term of glossary.terms) {
    assert.ok(!ids.has(term.id), `duplicate id ${term.id}`);
    ids.add(term.id);
    assert.ok(domains.has(term.domain), `${term.id}: unknown domain`);
    assert.ok(families.has(term.family), `${term.id}: unknown family`);
    assert.equal(families.get(term.family).domain, term.domain, `${term.id}: family outside its domain`);
    assert.ok(['active', 'retired'].includes(term.status), `${term.id}: unknown status`);
    assert.ok(Array.isArray(term.variants), `${term.id}: variants missing`);
    assert.ok(Array.isArray(term.notTheSameAs), `${term.id}: notTheSameAs missing`);
  }
  for (const term of glossary.terms) {
    for (const related of term.relatedIds) assert.ok(ids.has(related), `${term.id}: ${related} does not resolve`);
  }
});
