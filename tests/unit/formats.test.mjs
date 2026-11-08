import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FORMAT_MESSAGES, findProgressBlock, recognise } from '../../engine/formats.js';
import { fixtureText } from './fixtures.mjs';

test('a file is recognised by its top-level keys, a bundle before what it holds', () => {
  assert.equal(recognise(fixtureText('bundle-bakery.json')).kind, 'bundle');
  assert.equal(recognise(fixtureText('pack-bakery.json')).kind, 'pack');
  assert.equal(recognise(fixtureText('glossary.json')).kind, 'glossary');
  assert.equal(recognise(fixtureText('track-bakery.json')).kind, 'track');
  assert.equal(recognise('{"bundleId": "x", "packId": "y", "trackId": "z"}').kind, 'bundle');
  assert.equal(recognise('{"packId": "y", "glossaryVersion": "1.0"}').kind, 'pack');
  assert.equal(recognise('﻿{"trackId": "t"}').kind, 'track');
});

test('anything else gets a plain message', () => {
  for (const text of ['{"title": "Something"}', '[1, 2, 3]', '"text"', 'null', 'Not JSON at all', '', '<html></html>']) {
    assert.deepEqual(recognise(text), { kind: null, message: FORMAT_MESSAGES.notImportable }, text);
  }
  assert.deepEqual(recognise('{"testSetId": "hard-cards"}'), { kind: null, message: FORMAT_MESSAGES.testSet });
});

test('a Markdown report is known by its progress block, and one without it says so', () => {
  const report = ['# Bakery School — weekly report', '', 'Learner: Sam', '', '```json progress', '{"schemaVersion": 2}', '```', ''].join('\n');
  assert.deepEqual(recognise(report), { kind: 'report', data: '{"schemaVersion": 2}' });
  const noBlock = '# Bakery School — weekly report\n\nLearner: Sam\n';
  assert.deepEqual(recognise(noBlock), { kind: null, message: FORMAT_MESSAGES.reportWithoutBlock });
});

test('the progress block is the last one with that info string, fenced at any length', () => {
  const text = [
    'Some text',
    '```json progress',
    '{"first": true}',
    '```',
    '```json',
    '{"other": true}',
    '```',
    '````json progress',
    '{"text": "```"}',
    '```',
    '{"more": 1}',
    '````',
    'After',
  ].join('\n');
  assert.equal(findProgressBlock(text), '{"text": "```"}\n```\n{"more": 1}');
  assert.equal(findProgressBlock('~~~json progress\r\n{"a": 1}\r\n~~~\r\n'), '{"a": 1}');
  assert.equal(findProgressBlock('```json progress\n{"open": true}'), '{"open": true}');
  assert.equal(findProgressBlock('no block here'), null);
  // A fence inside another block is only text.
  assert.equal(findProgressBlock('````md\n```json progress\n{"inner": 1}\n```\n````'), null);
});
