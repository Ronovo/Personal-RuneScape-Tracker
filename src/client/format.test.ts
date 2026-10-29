/// <reference types="node" />
// The client tsconfig has no ambient Node types (browser lib only) - this
// file is the one exception, since node:test runs it directly against the
// compiled output rather than in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, fmtGpShort, fmtAgo, fmtAgoSince, safeJsonParse } from './format.js';

test('escapeHtml neutralizes every HTML-significant character', () => {
  assert.equal(escapeHtml('<script>alert("hi")</script>'), '&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
  assert.equal(escapeHtml(123), '123');
});

test('fmtGpShort renders compact k/m/b labels', () => {
  assert.equal(fmtGpShort(999), '999');
  assert.equal(fmtGpShort(1_500), '1.5k');
  assert.equal(fmtGpShort(12_000), '12k');
  assert.equal(fmtGpShort(2_300_000), '2.3m');
  assert.equal(fmtGpShort(23_400_000), '23.4m');
  assert.equal(fmtGpShort(1_200_000_000), '1.2b');
  assert.equal(fmtGpShort(-1_500), '-1.5k');
  assert.equal(fmtGpShort(null), 'n/a');
});

test('fmtAgo reads its argument as a duration in seconds', () => {
  assert.equal(fmtAgo(30), '30s ago');
  assert.equal(fmtAgo(90), '1m ago');
  assert.equal(fmtAgo(3600), '1h ago');
  assert.equal(fmtAgo(86_400 * 3), '3d ago');
  assert.equal(fmtAgo(null), 'n/a');
  // A long duration stays a duration. The previous single-argument version
  // guessed, and read anything over 1e8 seconds as a unix timestamp.
  assert.equal(fmtAgo(200_000_000), '2314d ago');
});

test('fmtAgoSince reads its argument as a unix timestamp', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  assert.equal(fmtAgoSince(nowSec - 3600), '1h ago');
  assert.equal(fmtAgoSince(nowSec - 45), '45s ago');
  assert.equal(fmtAgoSince(null), 'n/a');
});

test('safeJsonParse returns the fallback on missing or invalid JSON', () => {
  assert.deepEqual(safeJsonParse('{"a":1}', { a: 0 }), { a: 1 });
  assert.deepEqual(safeJsonParse('not json', { a: 0 }), { a: 0 });
  assert.deepEqual(safeJsonParse(null, { a: 0 }), { a: 0 });
});
