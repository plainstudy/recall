import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardRow, squareAt } from '../../engine/card-row.js';
import { startSession } from '../../engine/session.js';
import { clockAt } from './clock.mjs';
import { phoneWith } from './phone.mjs';
import { ctxOf, playCard } from './play.mjs';
import { seededRandom } from './seeded.mjs';
import { assembleDaily } from '../../engine/assemble.js';
import { learnerDay } from '../../engine/days.js';

function started() {
  const clock = clockAt('2026-11-15T07:14:00+03:00');
  const phone = phoneWith('bundle-bakery-next.json', clock);
  const random = seededRandom(4);
  const day = learnerDay(clock);
  const { plan, lengthSec } = assembleDaily({ progress: phone.progress, catalogue: phone.catalogue, day, lastShown: new Map(), random });
  return { state: { progress: phone.progress, session: startSession({ kind: 'daily', plan, day, lengthSec }, random) }, ctx: ctxOf(phone, clock, random) };
}

test('acceptance test 35, the row: right, wrong and read squares fill as cards are done, and keep their colour', () => {
  let { state, ctx } = started();
  const first = cardRow(state.session);
  assert.equal(first.squares.length, state.session.plan.length);
  assert.ok(first.squares.every((s) => s.state === 'ahead'));
  assert.deepEqual(first.squares.map((s) => s.showing), first.squares.map((_, i) => i === 0));
  assert.equal(first.passed, 0);
  assert.equal(first.label, `Card 1 of ${state.session.plan.length}: 0 right, 0 wrong, 0 read`);

  // Three cards: the second question answered wrong, which places a re-ask, the rest right.
  const typeAt = (i) => ctx.catalogue.cards.get(state.session.plan[i].cardId).card.type;
  const types = [0, 1, 2].map(typeAt);
  const wrongAt = types.findIndex((type) => type !== 'teach');
  const expected = types.map((type, i) => (type === 'teach' ? 'read' : i === wrongAt ? 'wrong' : 'right'));
  for (let i = 0; i < 3; i++) state = playCard(state, ctx, { wrong: () => i === wrongAt });
  const row = cardRow(state.session);
  assert.deepEqual(row.squares.slice(0, 3).map((s) => s.state), expected);
  assert.ok(expected.includes('wrong'));
  assert.equal(row.passed, 3);
  assert.ok(state.session.plan.some((item) => item.reAsk), 'the wrong answer placed a re-ask');
  assert.equal(row.squares.length, state.session.plan.length, 'the re-ask has a square of its own');
  assert.ok(row.squares.slice(3).every((s) => s.state === 'ahead'));
  const n = (state) => expected.filter((s) => s === state).length;
  assert.equal(row.label, `Card 4 of ${state.session.plan.length}: ${n('right')} right, ${n('wrong')} wrong, ${n('read')} read`);

  // Looking back at the second card marks its square, and changes nothing else.
  const back = cardRow(state.session, 1);
  assert.deepEqual(back.squares.map((s) => s.showing), back.squares.map((_, i) => i === 1));
  assert.deepEqual(back.squares.map((s) => s.state), row.squares.map((s) => s.state));
  assert.equal(back.label, row.label.replace(/^Card 4 /, 'Card 2 '));
});

test('a tap opens the square under it, or the nearest when it falls between two', () => {
  const edges = [
    [0, 10],
    [13, 23],
    [26, 36],
  ];
  assert.equal(squareAt(edges, 5), 0);
  assert.equal(squareAt(edges, 11), 0);
  assert.equal(squareAt(edges, 12.5), 1);
  assert.equal(squareAt(edges, 40), 2);
  assert.equal(squareAt(edges, -3), 0);
  assert.equal(squareAt([], 5), -1);
});
