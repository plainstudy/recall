import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainText, textSpans } from '../../engine/text.js';

test('a span between backticks is marked mono', () => {
  assert.deepEqual(textSpans('Set it to `T65` flour.'), [
    { text: 'Set it to ', mono: false },
    { text: 'T65', mono: true },
    { text: ' flour.', mono: false },
  ]);
  assert.deepEqual(textSpans('`A1` and `B2`'), [
    { text: 'A1', mono: true },
    { text: ' and ', mono: false },
    { text: 'B2', mono: true },
  ]);
});

test('an unmatched backtick is an ordinary character, and nothing else is interpreted', () => {
  assert.deepEqual(textSpans('A ` alone'), [{ text: 'A ` alone', mono: false }]);
  assert.deepEqual(textSpans('<b>not markup</b>\nline two'), [{ text: '<b>not markup</b>\nline two', mono: false }]);
  assert.deepEqual(textSpans(''), []);
  assert.deepEqual(textSpans(undefined), []);
});

test('plain text drops the backticks', () => {
  assert.equal(plainText('Use `T65` here'), 'Use T65 here');
});
