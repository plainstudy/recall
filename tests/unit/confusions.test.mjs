import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confusedPairs, recordConfusions } from '../../engine/confusions.js';
import { scoreAnswer } from '../../engine/scoring.js';
import { clockAt } from './clock.mjs';
import { phoneWith } from './phone.mjs';

const { catalogue } = phoneWith('bundle-bakery.json', clockAt('2026-11-15T07:14:00+03:00'));
const card = (id) => catalogue.cards.get(id).card;
const pairsFor = (c, answer) => confusedPairs(c, scoreAnswer(c, answer));

test('a wrong answer on a single-choice card pairs the chosen term with the correct one, in alphabetical order', () => {
  const mcq = card('bk_l01_c02'); // Levain is right; Poolish names a term; Brine names none
  assert.deepEqual(pairsFor(mcq, { choice: 'b' }), [['levain', 'poolish']]);
  assert.deepEqual(pairsFor(mcq, { choice: 'c' }), [], 'the chosen option names no term');
  assert.deepEqual(pairsFor(mcq, { choice: 'a' }), [], 'a right answer records nothing');
  // The other way round gives the same pair: taking A for B and B for A count together.
  const trap = card('bk_l02_c04'); // Poolish is right
  const wrong = trap.options.find((o) => !o.correct && o.termRef === 'levain');
  assert.deepEqual(pairsFor(trap, { choice: wrong.id }), [['levain', 'poolish']]);
});

test('cloze and desk cards record the same way, when both options name a term', () => {
  const cloze = {
    type: 'cloze',
    prompt: 'A ___.',
    chips: [
      { id: 'a', text: 'Scoring', correct: true, termRef: 'scoring' },
      { id: 'b', text: 'Levain', correct: false, termRef: 'levain' },
      { id: 'c', text: 'Other', correct: false },
    ],
  };
  assert.deepEqual(pairsFor(cloze, { choice: 'b' }), [['levain', 'scoring']]);
  assert.deepEqual(pairsFor(cloze, { choice: 'c' }), []);
  const desk = { type: 'desk', prompt: 'P', options: cloze.chips };
  assert.deepEqual(pairsFor(desk, { choice: 'b' }), [['levain', 'scoring']]);
  assert.deepEqual(pairsFor({ type: 'cloze', prompt: 'A ___.', chips: [{ id: 'a', text: 'x', correct: true }, cloze.chips[1], cloze.chips[2]] }, { choice: 'b' }), [], 'the correct one names no term');
});

test('a variant card pairs its own term with each wrongly chosen option that names one', () => {
  const variant = card('bk_l02_c05'); // the card's term is banneton; one wrong option names couche
  const wrongWithTerm = variant.options.find((o) => !o.correct && o.termRef === 'couche');
  const right = variant.options.filter((o) => o.correct).map((o) => o.id);
  assert.deepEqual(pairsFor(variant, { choices: [...right, wrongWithTerm.id] }), [['banneton', 'couche']]);
  assert.deepEqual(pairsFor(variant, { choices: [right[0]] }), [], 'a wrong answer made only of right options records nothing');
  assert.deepEqual(pairsFor(variant, { choices: right }), []);
  assert.deepEqual(pairsFor({ ...variant, termRef: undefined }, { choices: [wrongWithTerm.id] }), [], 'the card names no term');
});

test('other card types record nothing', () => {
  const multi = card('bk_l01_c06');
  assert.deepEqual(pairsFor(multi, { choices: ['d'] }), []);
  const match = card('bk_l01_c05');
  assert.deepEqual(pairsFor(match, { pairs: [['lv', 'pl'], ['pl', 'lv'], ['bn', 'bn']] }), []);
});

test('pairs are counted without direction, each kept once with the day it last happened', () => {
  let list = recordConfusions([], [['levain', 'poolish']], '2026-11-14');
  assert.deepEqual(list, [{ pair: ['levain', 'poolish'], count: 1, countAtLastContrast: 0, lastOn: '2026-11-14' }]);
  list = recordConfusions(list, [['levain', 'poolish']], '2026-11-15');
  list = recordConfusions(list, [['banneton', 'couche']], '2026-11-15');
  assert.deepEqual(list, [
    { pair: ['levain', 'poolish'], count: 2, countAtLastContrast: 0, lastOn: '2026-11-15' },
    { pair: ['banneton', 'couche'], count: 1, countAtLastContrast: 0, lastOn: '2026-11-15' },
  ]);
  // A pair stored the other way round is the same pair, and is put in order when it grows.
  const reversed = recordConfusions([{ pair: ['poolish', 'levain'], count: 4, countAtLastContrast: 2, lastOn: '2026-11-01' }], [['levain', 'poolish']], '2026-11-15');
  assert.deepEqual(reversed, [{ pair: ['levain', 'poolish'], count: 5, countAtLastContrast: 2, lastOn: '2026-11-15' }]);
  const before = [{ pair: ['levain', 'poolish'], count: 1, countAtLastContrast: 0, lastOn: '2026-11-14' }];
  assert.equal(recordConfusions(before, [], '2026-11-15'), before, 'nothing to record changes nothing');
});
