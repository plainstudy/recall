import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explanationFor, scoreAnswer, summaryLine, tally, verdictFor } from '../../engine/scoring.js';

const single = (type, listName = 'options') => ({
  type,
  [listName]: [
    { id: 'a', text: 'First', correct: false, feedback: 'Why first is tempting.' },
    { id: 'b', text: 'Second', correct: true, feedback: 'Why second is right.' },
    { id: 'c', text: 'Third', correct: false },
  ],
  feedback: 'The card explains itself.',
});

const several = (type) => ({
  type,
  options: [
    { id: 'a', text: 'One', correct: true, note: 'n1' },
    { id: 'b', text: 'Two', correct: true, note: 'n2' },
    { id: 'c', text: 'Three', correct: false, note: 'n3' },
    { id: 'd', text: 'Four', correct: false, note: 'n4' },
  ],
});

test('single-choice types score the chosen id, whatever the order on screen', () => {
  for (const [type, listName] of [
    ['mcq', 'options'],
    ['desk', 'options'],
    ['cloze', 'chips'],
    ['hotspot', 'regions'],
  ]) {
    const card = single(type, listName);
    assert.equal(scoreAnswer(card, { choice: 'b' }).correct, true, type);
    assert.equal(scoreAnswer(card, { choice: 'a' }).correct, false, type);
    assert.equal(scoreAnswer(card, { choice: 'zz' }).correct, false, type);
    assert.deepEqual(scoreAnswer(card, { choice: 'a' }).right, ['b'], type);
  }
});

test('multi and variant are all or nothing', () => {
  for (const type of ['multi', 'variant']) {
    const card = several(type);
    assert.equal(scoreAnswer(card, { choices: ['b', 'a'] }).correct, true, `${type}: exact set`);
    assert.equal(scoreAnswer(card, { choices: ['a'] }).correct, false, `${type}: subset`);
    assert.equal(scoreAnswer(card, { choices: ['a', 'b', 'c'] }).correct, false, `${type}: superset`);
    assert.equal(scoreAnswer(card, { choices: ['c', 'd'] }).correct, false, `${type}: wrong set`);
    assert.equal(scoreAnswer(card, { choices: ['a', 'a', 'b'] }).correct, true, `${type}: repeats ignored`);
  }
});

test('match scores by pair id', () => {
  const card = {
    type: 'match',
    pairs: [
      { id: '1', left: 'L1', right: 'R1' },
      { id: '2', left: 'L2', right: 'R2' },
      { id: '3', left: 'L3', right: 'R3' },
    ],
  };
  const right = scoreAnswer(card, { pairs: [['2', '2'], ['1', '1'], ['3', '3']] });
  assert.equal(right.correct, true);
  const wrong = scoreAnswer(card, { pairs: [['1', '2'], ['2', '1'], ['3', '3']] });
  assert.equal(wrong.correct, false);
  assert.deepEqual(
    wrong.pairs.map((p) => p.ok),
    [false, false, true],
  );
  assert.equal(scoreAnswer(card, { pairs: [['1', '1'], ['2', '2']] }).correct, false, 'incomplete');
});

test('order scores by position', () => {
  const card = {
    type: 'order',
    items: [
      { id: 'x', text: 'Third', position: 3 },
      { id: 'y', text: 'First', position: 1 },
      { id: 'z', text: 'Second', position: 2 },
    ],
  };
  const right = scoreAnswer(card, { sequence: ['y', 'z', 'x'] });
  assert.equal(right.correct, true);
  assert.deepEqual(right.expected, ['y', 'z', 'x']);
  const wrong = scoreAnswer(card, { sequence: ['y', 'x', 'z'] });
  assert.equal(wrong.correct, false);
  assert.deepEqual(
    wrong.sequence.map((s) => s.ok),
    [true, false, false],
  );
  assert.equal(scoreAnswer(card, { sequence: ['y', 'z'] }).correct, false, 'incomplete');
});

test('a teach card has no score', () => {
  assert.equal(scoreAnswer({ type: 'teach', prompt: 'Read this.' }, { choice: 'a' }), null);
});

test('verdicts use the plain words, and the trap words on a trap card', () => {
  assert.equal(verdictFor({ type: 'mcq' }, true), 'Correct.');
  assert.equal(verdictFor({ type: 'mcq' }, false), 'Incorrect.');
  assert.equal(verdictFor({ type: 'mcq', trap: true }, true), 'Trap cleared.');
  assert.equal(verdictFor({ type: 'variant', trap: true }, false), 'Trap.');
});

test('the explanation is the chosen option’s feedback, then the card’s', () => {
  const card = single('mcq');
  assert.deepEqual(explanationFor(card, { choice: 'a' }, false), ['Why first is tempting.', 'The card explains itself.']);
  assert.deepEqual(explanationFor(card, { choice: 'b' }, true), ['Why second is right.', 'The card explains itself.']);
  assert.deepEqual(explanationFor(card, { choice: 'c' }, false), ['The card explains itself.']);
  const hotspot = single('hotspot', 'regions');
  assert.deepEqual(explanationFor(hotspot, { choice: 'a' }, false)[0], 'Why first is tempting.');
});

test('after a wrong answer to a trap card, trapFeedback replaces the option’s feedback', () => {
  const card = { ...single('desk'), trap: true, trapFeedback: 'The trap, explained.' };
  assert.deepEqual(explanationFor(card, { choice: 'a' }, false), ['The trap, explained.', 'The card explains itself.']);
  assert.deepEqual(explanationFor(card, { choice: 'b' }, true), ['Why second is right.', 'The card explains itself.']);
  const noTrapText = { ...single('mcq'), trap: true };
  assert.deepEqual(explanationFor(noTrapText, { choice: 'a' }, false), [
    'Why first is tempting.',
    'The card explains itself.',
  ]);
});

test('on types without option feedback, a trap shows trapFeedback first, then the card’s', () => {
  const card = { ...several('variant'), trap: true, trapFeedback: 'The trap.', feedback: 'The card.' };
  assert.deepEqual(explanationFor(card, { choices: ['a'] }, false), ['The trap.', 'The card.']);
  assert.deepEqual(explanationFor(card, { choices: ['a', 'b'] }, true), ['The card.']);
  assert.deepEqual(explanationFor({ type: 'multi', options: [] }, { choices: [] }, false), []);
});

test('the lesson counts and their line', () => {
  const t = tally(15, [
    { trap: false, correct: true },
    { trap: true, correct: true },
    { trap: true, correct: false },
    { trap: false, correct: false },
  ]);
  assert.deepEqual(t, { cards: 15, answered: 4, correct: 2, trapsShown: 2, trapsCleared: 1 });
  assert.equal(summaryLine(t), '15 cards, 4 answered, 2 correct, 1 of 2 traps cleared.');
  assert.equal(
    summaryLine(tally(9, [{ trap: true, correct: true }])),
    '9 cards, 1 answered, 1 correct, 1 of 1 trap cleared.',
  );
  assert.equal(summaryLine(tally(1, [])), '1 card, 0 answered, 0 correct, no traps.');
});
