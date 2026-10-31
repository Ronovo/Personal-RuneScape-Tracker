/// <reference types="node" />
// The client tsconfig has no ambient Node types (browser lib only) - this
// file is the one exception, since node:test runs it directly against the
// compiled output rather than in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agoClass, errorMessage, escapeHtml, fetchJson, fmt, fmtAgo, fmtAgoSince, fmtGpShort, fmtSyncedAt, fmtTime,
  safeJsonParse, storageGet, storageRemove, storageSet,
} from './format.js';

test('fmtTime reads a missing time as n/a', () => {
  assert.equal(fmtTime(null), 'n/a');
  assert.equal(fmtTime(0), 'n/a');
  assert.equal(fmtTime(1_700_000_000),
    new Date(1_700_000_000_000).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }));
});

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
  assert.equal(fmtGpShort(12_000_000_000), '12b');
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

test('missing numbers and dates read n/a, and a date that does not parse is shown as sent', () => {
  assert.equal(fmt(null), 'n/a');
  assert.equal(fmt(1_234_567), '1,234,567');
  assert.equal(fmtSyncedAt(''), 'n/a');
  assert.equal(fmtSyncedAt('last Tuesday'), 'last Tuesday');
});

test('agoClass grades a last trade as fresh, ageing or stale', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  assert.equal(agoClass(null), '');
  assert.equal(agoClass(nowSec - 60), 'up');
  assert.equal(agoClass(nowSec - 20 * 60), 'ago-amber');
  assert.equal(agoClass(nowSec - 45 * 60), 'down');
});

test('the storage helpers shrug off a store that refuses, or one that cannot even be reached', () => {
  const refusing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('full'); },
    removeItem() { throw new Error('blocked'); },
  } as unknown as Storage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: refusing });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new Error('SecurityError'); },
  });
  try {
    for (const store of ['local', 'session'] as const) {
      assert.equal(storageGet(store, 'key'), null);
      assert.equal(storageSet(store, 'key', 'value'), false);
      assert.doesNotThrow(() => storageRemove(store, 'key'));
    }
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
});

test('the storage helpers read and write the store they name', () => {
  const store = () => {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    };
  };
  const local = store();
  const session = store();
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });
  try {
    assert.equal(storageSet('local', 'key', 'kept'), true);
    assert.equal(storageSet('session', 'key', 'for now'), true);
    assert.deepEqual([storageGet('local', 'key'), storageGet('session', 'key')], ['kept', 'for now']);
    storageRemove('session', 'key');
    assert.deepEqual([local.items.size, session.items.size], [1, 0]);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
});

test('errorMessage uses the fallback for anything thrown that is not an Error', () => {
  assert.equal(errorMessage(new Error('Boom'), 'Failed'), 'Boom');
  assert.equal(errorMessage('Boom', 'Failed'), 'Failed');
});

test('a reply with no content type is not read as JSON', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  Object.assign(globalThis, { localStorage: { getItem: () => null } });
  try {
    await assert.rejects(fetchJson('/api/anything'), /Server returned HTML instead of JSON/);
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
