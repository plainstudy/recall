import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysBetween } from '../../engine/days.js';
import { INTERVAL_DAYS, answerAtom, backlog, cardForAtom, dueList, isDue, notYetDue, reachableCards } from '../../engine/schedule.js';
import { clockAt } from './clock.mjs';
import { at, installOn, phoneWith } from './phone.mjs';
import { seededRandom } from './seeded.mjs';

const DAY = '2026-11-15';
const STAMP = '2026-11-15T07:14:00+03:00';
const clock = () => clockAt(STAMP);

// An atom as progress holds it, due today unless told otherwise.
const atomIn = (box, more = {}) => ({
  box,
  dueOn: DAY,
  introducedOn: '2026-11-01',
  lastSeenOn: '2026-11-10',
  lastPromotedOn: '2026-11-10',
  correctStreak: 2,
  wrongStreak: 0,
  totalSeen: 4,
  totalWrong: 1,
  lastMissedCardId: null,
  trap: false,
  changedAt: '2026-11-10T07:00:00+03:00',
  ...more,
});

// An answer in a daily session today, unless told otherwise.
const answer = (more = {}) => ({ correct: true, cardId: 'c1', day: DAY, stamp: STAMP, kind: 'daily', reAsk: false, early: false, trapAtom: false, ...more });

const apply = (atom, more, seed = 1) => answerAtom(atom, answer(more), seededRandom(seed));

test('the five boxes and their intervals', () => {
  assert.deepEqual(INTERVAL_DAYS, { 1: 1, 2: 3, 3: 7, 4: 21, 5: 60 });
  assert.equal(isDue({ dueOn: DAY }, DAY), true);
  assert.equal(isDue({ dueOn: '2026-11-14' }, DAY), true);
  assert.equal(isDue({ dueOn: '2026-11-16' }, DAY), false);
});

test('§4.2 row 1: an atom met for the first time enters box 1, due tomorrow, in any session', () => {
  for (const kind of ['daily', 'redo']) {
    for (const correct of [true, false]) {
      const { atom, introduced, movedUp } = apply(null, { kind, correct });
      assert.equal(introduced, true);
      assert.equal(movedUp, false, 'entering box 1 is not a promotion');
      assert.deepEqual(atom, {
        box: 1,
        dueOn: '2026-11-16',
        introducedOn: DAY,
        lastSeenOn: DAY,
        lastPromotedOn: null,
        correctStreak: correct ? 1 : 0,
        wrongStreak: correct ? 0 : 1,
        totalSeen: 1,
        totalWrong: correct ? 0 : 1,
        lastMissedCardId: correct ? null : 'c1',
        trap: false,
        changedAt: STAMP,
      });
    }
  }
});

test("§4.2 row 2: a due atom's first answer of the day in a daily session moves it up one box, due after that box's interval", () => {
  for (const [from, to] of [[1, 2], [2, 3], [3, 4], [4, 5], [5, 5]]) {
    const { atom, movedUp, introduced } = apply(atomIn(from));
    assert.equal(atom.box, to);
    assert.equal(movedUp, to > from);
    assert.equal(introduced, false);
    assert.equal(atom.lastPromotedOn, DAY);
    assert.equal(atom.lastSeenOn, DAY);
    const days = daysBetween(DAY, atom.dueOn);
    assert.ok(Math.abs(days - INTERVAL_DAYS[to]) <= (to >= 3 ? 1 : 0), `box ${to}: due in ${days} days`);
    assert.deepEqual([atom.correctStreak, atom.wrongStreak, atom.totalSeen, atom.totalWrong], [3, 0, 5, 1]);
    assert.equal(atom.changedAt, STAMP);
    assert.equal(atom.introducedOn, '2026-11-01');
  }
});

test('§4.2 row 2, wrong: box 1, due tomorrow, whatever the box (test 5)', () => {
  for (const box of [1, 2, 3, 4, 5]) {
    const { atom, movedUp } = apply(atomIn(box), { correct: false, cardId: 'c7' });
    assert.deepEqual([atom.box, atom.dueOn, movedUp], [1, '2026-11-16', false]);
    assert.deepEqual([atom.correctStreak, atom.wrongStreak, atom.totalSeen, atom.totalWrong], [0, 1, 5, 2]);
    assert.equal(atom.lastMissedCardId, 'c7');
    assert.equal(atom.lastPromotedOn, '2026-11-10', 'a demotion is not a promotion');
  }
});

test('§4.2 row 3: a re-ask, a second answer the same day, an early review, a redo and a not-yet-due atom never promote, and still demote', () => {
  const due = atomIn(3);
  const cases = [
    ['a re-ask', due, { reAsk: true }],
    ['a second answer the same day', atomIn(3, { lastSeenOn: DAY }), {}],
    ['an early review', atomIn(3, { dueOn: '2026-11-20' }), { early: true }],
    ['a redo', due, { kind: 'redo' }],
    ['a not-yet-due atom met again in the lesson', atomIn(3, { dueOn: '2026-11-18' }), {}],
    ['an atom already promoted today', atomIn(3, { lastPromotedOn: DAY, lastSeenOn: '2026-11-14' }), {}],
  ];
  for (const [name, atom, more] of cases) {
    const right = apply(atom, more);
    assert.deepEqual([right.atom.box, right.atom.dueOn, right.movedUp], [3, atom.dueOn, false], name);
    assert.equal(right.atom.lastPromotedOn, atom.lastPromotedOn, name);
    assert.equal(right.atom.totalSeen, 5, name);
    assert.equal(right.atom.changedAt, STAMP, `${name}: every change sets the change time`);
    const wrong = apply(atom, { ...more, correct: false });
    assert.deepEqual([wrong.atom.box, wrong.atom.dueOn], [1, '2026-11-16'], `${name}, wrong`);
    assert.equal(wrong.atom.wrongStreak, 1, name);
  }
});

test("one promotion a day, across a redo too: the day's first answer counts answers in every kind of session", () => {
  // A redo first: the due atom is answered, and not promoted.
  const afterRedo = apply(atomIn(2), { kind: 'redo' }).atom;
  assert.deepEqual([afterRedo.box, afterRedo.dueOn, afterRedo.lastSeenOn], [2, DAY, DAY]);
  // The daily session after it, the same day: still due, but no longer the day's first answer.
  const afterDaily = apply(afterRedo, { stamp: '2026-11-15T07:30:00+03:00' });
  assert.deepEqual([afterDaily.atom.box, afterDaily.movedUp], [2, false]);
  // The next day it is promoted.
  const next = answerAtom(afterDaily.atom, answer({ day: '2026-11-16', stamp: '2026-11-16T07:00:00+03:00' }), seededRandom(1));
  assert.deepEqual([next.atom.box, next.movedUp, next.atom.lastPromotedOn], [3, true, '2026-11-16']);
  assert.ok(Math.abs(daysBetween('2026-11-16', next.atom.dueOn) - 7) <= 1);

  // Two daily sessions the same day: promoted in the first, not again in the second.
  const first = apply(atomIn(1)).atom;
  assert.equal(first.box, 2);
  const second = apply({ ...first, dueOn: DAY }, {});
  assert.equal(second.atom.box, 2);
});

test('acceptance test 6: a due atom answered correctly, first that day, in a daily session, moves from box 3 to box 4, due 21 days out ±1, and from box 4 to box 5, due 60 days out ±1; the jitter is only in boxes 3 to 5', () => {
  const seen = { 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set() };
  for (let seed = 1; seed <= 60; seed++) {
    for (const from of [1, 2, 3, 4]) {
      const { atom, movedUp } = apply(atomIn(from), {}, seed);
      assert.deepEqual([atom.box, movedUp], [from + 1, true], `from box ${from}`);
      seen[atom.box].add(daysBetween(DAY, atom.dueOn));
    }
  }
  assert.deepEqual([...seen[2]], [3], 'box 2 has no jitter');
  assert.deepEqual([...seen[3]].sort((a, b) => a - b), [6, 7, 8]);
  assert.deepEqual([...seen[4]].sort((a, b) => a - b), [20, 21, 22]);
  assert.deepEqual([...seen[5]].sort((a, b) => a - b), [59, 60, 61]);
  // Box 1 has none either: a first meeting and a wrong answer are always due tomorrow.
  for (let seed = 1; seed <= 20; seed++) {
    assert.equal(apply(null, {}, seed).atom.dueOn, '2026-11-16');
    assert.equal(apply(atomIn(5), { correct: false }, seed).atom.dueOn, '2026-11-16');
  }
});

test('an atom in box 5 answered correctly stays in box 5, due in 60 days', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { atom, movedUp } = apply(atomIn(5), {}, seed);
    assert.deepEqual([atom.box, movedUp], [5, false]);
    assert.ok(Math.abs(daysBetween(DAY, atom.dueOn) - 60) <= 1);
  }
});

test('a trap atom: wrong is box 1 tomorrow with no jitter, and correct in box 4 stays in box 4 (test 13)', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const wrong = apply(atomIn(4, { trap: true }), { correct: false, trapAtom: true }, seed).atom;
    assert.deepEqual([wrong.box, wrong.dueOn, wrong.trap], [1, '2026-11-16', true]);
    const right = apply(atomIn(4, { trap: true }), { trapAtom: true }, seed);
    assert.deepEqual([right.atom.box, right.movedUp], [4, false]);
    assert.ok(Math.abs(daysBetween(DAY, right.atom.dueOn) - 21) <= 1, 'never left alone for 60 days');
  }
  assert.equal(apply(atomIn(3), { trapAtom: true }).atom.box, 4, 'a trap atom still climbs to box 4');
  assert.equal(apply(atomIn(3), { trapAtom: true }).atom.trap, true, 'the flag follows the cards');
  assert.equal(apply(atomIn(3, { trap: true }), { trapAtom: false }).atom.trap, false);
  // An atom already above the cap when one of its cards became a trap comes down to it.
  assert.equal(apply(atomIn(5), { trapAtom: true }).atom.box, 4);
});

test('a late review keeps its box, and its next interval counts from the day it is answered', () => {
  const late = atomIn(2, { dueOn: '2026-11-01', lastSeenOn: '2026-10-29' });
  const { atom, movedUp } = apply(late);
  assert.deepEqual([atom.box, movedUp], [3, true], 'up one from the box it kept, not sent back for being late');
  assert.ok(Math.abs(daysBetween(DAY, atom.dueOn) - 7) <= 1, 'counted from today, not from the day it was due');
});

test('an atom met first in a redo is introduced there, and promoted only from the next day', () => {
  const met = apply(null, { kind: 'redo', cardId: 'new-card' });
  assert.deepEqual([met.introduced, met.atom.box, met.atom.dueOn, met.atom.introducedOn], [true, 1, '2026-11-16', DAY]);
  const sameDay = apply(met.atom, {});
  assert.equal(sameDay.atom.box, 1, 'not due yet, and already answered today');
  const nextDay = answerAtom(met.atom, answer({ day: '2026-11-16', stamp: '2026-11-16T07:00:00+03:00' }), seededRandom(1));
  assert.deepEqual([nextDay.atom.box, nextDay.atom.dueOn], [2, '2026-11-19']);
});

test('the missed card is remembered, and cleared when it is answered correctly in a later daily session', () => {
  const missed = apply(atomIn(3), { correct: false, cardId: 'c2' }).atom;
  assert.equal(missed.lastMissedCardId, 'c2');
  const next = { day: '2026-11-16', stamp: '2026-11-16T07:00:00+03:00' };
  const keep = [
    ['a correct re-ask', { cardId: 'c2', reAsk: true }],
    ['a correct answer in a redo', { ...next, cardId: 'c2', kind: 'redo' }],
    ['a correct answer to another card of the atom', { ...next, cardId: 'c3' }],
  ];
  for (const [name, more] of keep) assert.equal(apply(missed, more).atom.lastMissedCardId, 'c2', name);
  assert.equal(apply(missed, { ...next, cardId: 'c2' }).atom.lastMissedCardId, null);
  assert.equal(apply(missed, { ...next, cardId: 'c3', correct: false }).atom.lastMissedCardId, 'c3', 'a newer miss takes its place');
});

test('reachable cards: completed lessons, and the current lesson before the current card (§4.3)', () => {
  const phone = phoneWith('bundle-bakery.json', clock());
  const keys = (position) => [...reachableCards(phone.catalogue, { ...phone.progress.position, ...position }).keys()];
  assert.deepEqual(keys({}), [], 'a new learner has reached nothing');
  assert.deepEqual(keys({ currentCardIndex: 4 }), ['atom.ingredient.levain', 'atom.ingredient.hydration'], 'lesson 1, cards before the fifth');
  const lessonOne = ['levain', 'hydration', 'pre-ferments', 'raising-agents'].map((s) => `atom.ingredient.${s}`);
  assert.deepEqual(keys({ currentLesson: 'bk_l02', currentCardIndex: 2, lessonsCompleted: ['bk_l01'] }), [
    ...lessonOne,
    'atom.technique.loaf-steps',
    'atom.technique.timing',
    'atom.desk.order-note',
    'atom.technique.scoring-ear',
  ]);
  assert.equal(keys({ currentLesson: null, lessonsCompleted: ['bk_l01', 'bk_l02'] }).length, 13, 'every lesson done');
  assert.deepEqual(keys({ lessonsCompleted: ['a-lesson-that-has-gone'] }), []);
});

test('which card tests an atom: the missed card first, then never presented, then presented longest ago, then file order (§4.3)', () => {
  const entries = ['a', 'b', 'c'].map((id, seq) => ({ card: { cardId: id }, seq }));
  const shown = (pairs) => new Map(pairs);
  assert.equal(cardForAtom(atomIn(1), entries, shown([])).card.cardId, 'a', 'none presented: file order');
  assert.equal(cardForAtom(atomIn(1), entries, shown([['a', 50]])).card.cardId, 'b', 'never-presented cards first');
  assert.equal(cardForAtom(atomIn(1), entries, shown([['a', 50], ['b', 20], ['c', 30]])).card.cardId, 'b', 'the one presented longest ago');
  assert.equal(cardForAtom(atomIn(1), entries, shown([['a', 20], ['b', 20], ['c', 30]])).card.cardId, 'a', 'a tie goes to file order');
  assert.equal(cardForAtom(atomIn(1, { lastMissedCardId: 'c' }), entries, shown([['c', 99]])).card.cardId, 'c', 'the missed card first');
  assert.equal(cardForAtom(atomIn(1, { lastMissedCardId: 'gone' }), entries, shown([['a', 1]])).card.cardId, 'b', "a missed card that can't be reached is passed over");
  assert.equal(cardForAtom(null, entries, shown([])).card.cardId, 'a', 'an atom not yet introduced');
  assert.equal(cardForAtom(atomIn(1), [], shown([])), null);
});

test('the due list: atoms due today with a reachable card, the most overdue first, then the lower box, then the key (§4.4)', () => {
  const base = at(phoneWith('bundle-bakery.json', clock()), { currentLesson: 'bk_l02', currentCardIndex: 0, lessonsCompleted: ['bk_l01'] });
  const atoms = {
    'atom.ingredient.levain': atomIn(3, { dueOn: '2026-11-13' }),
    'atom.ingredient.hydration': atomIn(2, { dueOn: '2026-11-15' }),
    'atom.ingredient.pre-ferments': atomIn(1, { dueOn: '2026-11-15' }),
    'atom.ingredient.raising-agents': atomIn(1, { dueOn: '2026-11-15' }),
    'atom.technique.loaf-steps': atomIn(4, { dueOn: '2026-11-16' }),
    'atom.technique.timing': atomIn(1, { dueOn: '2026-11-01' }),
    'atom.desk.order-note': atomIn(2, { dueOn: '2026-11-20' }),
    // Its card is in lesson 2, not reached yet: in progress, but never scheduled.
    'atom.tool.banneton': atomIn(1, { dueOn: '2026-11-01' }),
    // Its cards have left the installed packs.
    'atom.old.gone': atomIn(1, { dueOn: '2026-11-01' }),
  };
  const phone = { ...base, progress: { ...base.progress, atoms } };
  const due = dueList(phone.progress, phone.catalogue, DAY);
  assert.deepEqual(
    due.map((d) => [d.key, d.overdue, d.box]),
    [
      ['atom.technique.timing', 14, 1],
      ['atom.ingredient.levain', 2, 3],
      ['atom.ingredient.pre-ferments', 0, 1],
      ['atom.ingredient.raising-agents', 0, 1],
      ['atom.ingredient.hydration', 0, 2],
    ],
  );
  assert.ok(due.every((d) => d.entries.length > 0));
  assert.deepEqual(
    notYetDue(phone.progress, phone.catalogue, DAY).map((d) => d.key),
    ['atom.technique.loaf-steps', 'atom.desk.order-note'],
    'the soonest due first',
  );
});

test('an atom a content update adds to a lesson already completed is due at once, ranked as box 1 (test 37)', () => {
  const c = clock();
  let phone = at(phoneWith('bundle-bakery.json', c), { currentLesson: 'bk_l02', currentCardIndex: 0, lessonsCompleted: ['bk_l01'] });
  const lessonOne = [...phone.catalogue.atoms].filter(([, entries]) => entries[0].lessonId === 'bk_l01').map(([key]) => key);
  const atoms = Object.fromEntries(lessonOne.map((key) => [key, atomIn(2, { dueOn: '2026-11-18' })]));
  atoms['atom.ingredient.levain'] = atomIn(2, { dueOn: '2026-11-15' });
  phone = { ...phone, progress: { ...phone.progress, atoms } };
  assert.deepEqual(dueList(phone.progress, phone.catalogue, DAY).map((d) => d.key), ['atom.ingredient.levain']);

  // The pack update puts a card with a new key into lesson 1.
  phone = installOn(phone, 'pack-bakery-next.json', c);
  assert.equal(phone.progress.position.currentLesson, 'bk_l02');
  assert.equal(phone.progress.atoms['atom.ingredient.salt'], undefined, 'no entry yet');
  const due = dueList(phone.progress, phone.catalogue, DAY);
  assert.deepEqual(due.map((d) => [d.key, d.overdue, d.box, d.atom === null]), [
    ['atom.ingredient.salt', 0, 1, true],
    ['atom.ingredient.levain', 0, 2, false],
  ]);
  const card = cardForAtom(due[0].atom, due[0].entries, new Map());
  assert.equal(card.card.cardId, 'bk_l01_c10');
  // Its first answer introduces it into box 1.
  const met = answerAtom(due[0].atom, answer({ cardId: card.card.cardId }), seededRandom(1));
  assert.deepEqual([met.introduced, met.atom.box, met.atom.dueOn, met.atom.introducedOn], [true, 1, '2026-11-16', DAY]);
});

test('the backlog switch turns on above 40 due and off below 20, and holds in between (test 7)', () => {
  assert.equal(backlog(41, false), true);
  assert.equal(backlog(40, false), false, 'exactly 40 is not more than 40');
  assert.equal(backlog(40, true), true);
  assert.equal(backlog(34, true), true, 'still clearing');
  assert.equal(backlog(20, true), true, 'exactly 20 is not fewer than 20');
  assert.equal(backlog(19, true), false);
  assert.equal(backlog(25, false), false);
  assert.equal(backlog(0, true), false);
});
