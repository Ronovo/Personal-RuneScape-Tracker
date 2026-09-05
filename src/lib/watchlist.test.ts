import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-watchlist-test-'));
process.env.WATCHLIST_DATA_DIR = tmp;
const { loadWatchlist, saveWatchlist } = await import('./watchlist.js');

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env.WATCHLIST_DATA_DIR;
});

test('a player with no watchlist reads as empty, not as an error', async () => {
  assert.deepEqual(await loadWatchlist('nobody'), []);
});

test('saveWatchlist de-dupes, drops non-integers, and preserves order', async () => {
  const saved = await saveWatchlist('Zezima', [4151, 4151, 'x', 1.5, null, 561, undefined, NaN]);
  assert.deepEqual(saved, [4151, 561]);
  assert.deepEqual(await loadWatchlist('zezima'), [4151, 561]);
});

test('the watchlist is keyed by the normalised name, like every other player file', async () => {
  await saveWatchlist('Some Player', [1]);
  assert.deepEqual(await loadWatchlist('SOME PLAYER'), [1]);
});

test('a non-array body and an over-long list are both rejected', async () => {
  await assert.rejects(() => saveWatchlist('zezima', { itemIds: [1] }), /Invalid watchlist/);
  const tooMany = Array.from({ length: 201 }, (_, i) => i);
  await assert.rejects(() => saveWatchlist('zezima', tooMany), /cannot exceed 200 items/);
});
