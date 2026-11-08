import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, fullVersion, isContentVersion, isVersion } from '../../engine/versions.js';

test('versions compare part by part as numbers, a missing part counting as 0', () => {
  assert.equal(compareVersions('1.10', '1.9'), 1);
  assert.equal(compareVersions('1.9', '1.10'), -1);
  assert.equal(compareVersions('1.1', '1.1.0'), 0);
  assert.equal(compareVersions('0.2.0', '0.2'), 0);
  assert.equal(compareVersions('0.3.0', '0.2.9'), 1);
  assert.equal(compareVersions('1.1', '0.2.0'), 1);
  assert.equal(compareVersions('2', '1.99.99'), 1);
});

test('a version has one to three numbers; a content version exactly two', () => {
  for (const v of ['1', '1.2', '0.2.0', '10.20.30']) assert.ok(isVersion(v), v);
  for (const v of ['', '1.', '.1', '1.2.3.4', 'v1.2', '1.2b', 12, null]) assert.ok(!isVersion(v), String(v));
  for (const v of ['1.0', '1.10', '0.2']) assert.ok(isContentVersion(v), v);
  for (const v of ['1', '1.0.0', '1.x', 1.2]) assert.ok(!isContentVersion(v), String(v));
});

test('a version is written in full for messages', () => {
  assert.equal(fullVersion('1.1'), '1.1.0');
  assert.equal(fullVersion('0.3.0'), '0.3.0');
  assert.equal(fullVersion('2'), '2.0.0');
});
