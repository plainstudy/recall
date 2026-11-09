import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTestable } from '../../engine/scoring.js';
import { clockAt } from './clock.mjs';
import { fixture } from './fixtures.mjs';
import { phoneWith } from './phone.mjs';

const clock = () => clockAt('2026-11-15T07:14:00+03:00');

test('the next bundle holds the next glossary, both packs and the next track, each exactly as its own file', () => {
  const bundle = fixture('bundle-bakery-next.json');
  assert.deepEqual([bundle.bundleId, bundle.bundleVersion, bundle.title], ['bakery', '1.1', 'Bakery School']);
  assert.deepEqual(bundle.glossary, fixture('glossary-next.json'));
  assert.deepEqual(bundle.packs, [fixture('pack-bakery-next.json'), fixture('pack-pastry.json')]);
  assert.deepEqual(bundle.track, fixture('track-bakery-next.json'));
  assert.deepEqual(bundle.track.packs, ['bakery_basics', 'pastry_basics']);
});

test('the next bundle installs on a new phone and over the first one, and its lessons follow the track', () => {
  const fresh = phoneWith('bundle-bakery-next.json', clock());
  assert.deepEqual(fresh.catalogue.order.lessons.map((e) => e.lesson.lessonId), ['bk_l01', 'bk_l02', 'pa_l01', 'pa_l02']);
  assert.equal(fresh.catalogue.order.stoppedAt, null);
  const updated = phoneWith(['bundle-bakery.json', 'bundle-bakery-next.json'], clock());
  assert.deepEqual(updated.progress.installed.packs, { bakery_basics: '1.1', pastry_basics: '1.0' });
  assert.deepEqual([updated.progress.installed.bundleVersion, updated.progress.installed.trackVersion, updated.progress.installed.glossaryVersion], ['1.1', '1.1', '1.2']);
});

test('the pastry pack has two verified lessons, each ending on a desk card and at least 60% testable', () => {
  const { catalogue } = phoneWith('bundle-bakery-next.json', clock());
  for (const id of ['pa_l01', 'pa_l02']) {
    const { lesson, packId } = catalogue.lessons.get(id);
    assert.equal(packId, 'pastry_basics');
    assert.equal(lesson.verification.status, 'verified');
    assert.equal(lesson.cards[lesson.cards.length - 1].type, 'desk');
    assert.ok(lesson.cards.filter(isTestable).length >= 0.6 * lesson.cards.length);
  }
});

test('one pastry card tests an atom met in the bakery pack, and its terms sit in the pastry domain', () => {
  const { catalogue, content } = phoneWith('bundle-bakery-next.json', clock());
  assert.deepEqual(catalogue.atoms.get('atom.ingredient.hydration').map((e) => e.card.cardId), ['bk_l01_c04', 'pa_l01_c05']);
  const card = catalogue.cards.get('pa_l01_c02').card;
  assert.equal(catalogue.familyOf(card), 'laminating');
  const term = content.glossary.terms.find((t) => t.id === 'lamination');
  assert.deepEqual([term.domain, term.family], ['pastry', 'laminating']);
});
