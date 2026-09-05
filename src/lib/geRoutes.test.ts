import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// This file exercises app.ts's own query-string parsing (num/numOrFallback/
// whitelisted) through the real /api/ge/* HTTP routes, rather than calling
// prices.ts's getMovers/getFlipCandidates directly the way prices.test.ts
// does - the parsing layer between the query string and those functions has
// no coverage otherwise.
//
// Same SYNC_DATA_DIR-before-first-import requirement as app.test.ts.
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-ge-routes-test-'));
const watchlistTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-ge-routes-watchlist-test-'));
process.env.SYNC_DATA_DIR = tmpDir;
process.env.WATCHLIST_DATA_DIR = watchlistTmpDir;
process.env.JWT_SECRET = 'ge-routes-test-secret';
process.env.RATE_LIMIT_MAX = '0';

// One fixture item: priced so it's a riser (current > 24h-ago) with plenty
// of volume, a real buy limit, and trades ~10 min old - fresh enough to clear
// every route's default filters (and the 30-min staleness cutoff), but old
// enough that a tight maxAgeMinutes can still filter it out.
const ITEM_ID = 1;
const nowSec = Math.floor(Date.now() / 1000);
const TRADE_TIME = nowSec - 600;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const originalFetch = globalThis.fetch;
let base = '';

globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  // Requests to this test's own Express server pass through untouched -
  // only upstream wiki-price-API-shaped URLs get stubbed below.
  if (base && u.startsWith(base)) return originalFetch(url, init);

  if (u.endsWith('/mapping')) {
    return jsonResponse([{ id: ITEM_ID, name: 'Test Item', members: false, icon: 'Test_Item.png', limit: 100, highalch: 0 }]);
  }
  if (u.endsWith('/latest')) {
    return jsonResponse({ data: { [ITEM_ID]: { high: 1000, highTime: TRADE_TIME, low: 900, lowTime: TRADE_TIME } } });
  }
  if (u.endsWith('/24h')) {
    return jsonResponse({ data: { [ITEM_ID]: { avgHighPrice: 800, avgLowPrice: 750, highPriceVolume: 2000, lowPriceVolume: 2000 } } });
  }
  if (u.includes('/1h?timestamp=')) {
    return jsonResponse({ data: { [ITEM_ID]: { avgHighPrice: 950, avgLowPrice: 900 } } });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const { createApp } = await import('./app.js');
const app = createApp();
const server = app.listen(0);
await new Promise<void>((resolve) => server.once('listening', resolve));
base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(watchlistTmpDir, { recursive: true, force: true });
});

test('/api/ge/movers falls back to defaults for unrecognized sort/view/membersOnly instead of erroring', async () => {
  const res = await fetch(`${base}/api/ge/movers?sort=bogus&view=bogus&membersOnly=bogus`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as { risers: { id: number }[] };
  // view fell back to 'risers', so the response has a risers array (a real
  // 'view=bogus' with the whitelist check removed would otherwise 500 on
  // the unhandled switch case inside getMovers).
  assert.ok(Array.isArray(data.risers));
  assert.ok(data.risers.some((i) => i.id === ITEM_ID));
});

test('/api/ge/movers serves view=volume and drops retired views to risers', async () => {
  const volume = await fetch(`${base}/api/ge/movers?view=volume`);
  assert.equal(volume.status, 200);
  const volumeData = (await volume.json()) as { items?: { id: number }[] };
  assert.ok(Array.isArray(volumeData.items));
  assert.ok(volumeData.items!.some((i) => i.id === ITEM_ID));

  // Penny Arcade / Spread / GP-per-Hour moved to the Flip Helper, and
  // 'staircase' was retired before them. Old bookmarks land on Rising rather
  // than 500ing on an unhandled switch case inside getMovers.
  for (const view of ['penny', 'spread', 'velocity', 'staircase']) {
    const res = await fetch(`${base}/api/ge/movers?view=${view}`);
    assert.equal(res.status, 200, `view=${view}`);
    const data = (await res.json()) as { risers: unknown[]; items?: unknown[] };
    assert.ok(Array.isArray(data.risers), `view=${view} fell back to risers`);
    assert.equal(data.items, undefined, `view=${view} has no special-view payload`);
  }
});

test('/api/ge/movers accepts sortDir and ignores anything but asc', async () => {
  const asc = await fetch(`${base}/api/ge/movers?sort=price&sortDir=asc`);
  assert.equal(asc.status, 200);
  const ascData = (await asc.json()) as { risers: { currentPrice: number }[] };
  const ascPrices = ascData.risers.map((i) => i.currentPrice);
  for (let i = 1; i < ascPrices.length; i++) assert.ok(ascPrices[i - 1]! <= ascPrices[i]!);

  const bogus = await fetch(`${base}/api/ge/movers?sort=price&sortDir=sideways`);
  const bogusData = (await bogus.json()) as { risers: { currentPrice: number }[] };
  const prices = bogusData.risers.map((i) => i.currentPrice);
  for (let i = 1; i < prices.length; i++) assert.ok(prices[i - 1]! >= prices[i]!); // fell back to desc
});

test('/api/ge/movers maxAgeMinutes parses and filters by trade age', async () => {
  const wide = await fetch(`${base}/api/ge/movers?maxAgeMinutes=30`);
  const wideData = (await wide.json()) as { risers: { id: number }[] };
  assert.ok(wideData.risers.some((i) => i.id === ITEM_ID)); // ~10 min old, inside 30

  const narrow = await fetch(`${base}/api/ge/movers?maxAgeMinutes=5`);
  const narrowData = (await narrow.json()) as { risers: { id: number }[] };
  assert.ok(!narrowData.risers.some((i) => i.id === ITEM_ID)); // outside 5
});

test('/api/ge/flips minMarginVsAvg parses and filters', async () => {
  // Fixture margin = 1000-900 = 100; 24h avg margin = 800-750 = 50 -> ratio 2.0.
  const pass = await fetch(`${base}/api/ge/flips?minMarginVsAvg=1.5`);
  const passData = (await pass.json()) as { items: { id: number }[] };
  assert.ok(passData.items.some((i) => i.id === ITEM_ID));

  const drop = await fetch(`${base}/api/ge/flips?minMarginVsAvg=3`);
  const dropData = (await drop.json()) as { items: { id: number }[] };
  assert.ok(!dropData.items.some((i) => i.id === ITEM_ID));
});

test('/api/ge/movers treats an empty maxPrice as no cap, but a real maxPrice still filters', async () => {
  const noCap = await fetch(`${base}/api/ge/movers?maxPrice=`);
  const noCapData = (await noCap.json()) as { risers: { id: number }[] };
  assert.ok(noCapData.risers.some((i) => i.id === ITEM_ID));

  const capped = await fetch(`${base}/api/ge/movers?maxPrice=500`);
  const cappedData = (await capped.json()) as { risers: { id: number }[] };
  assert.ok(!cappedData.risers.some((i) => i.id === ITEM_ID));
});

test('/api/ge/flips falls back to the nearest whitelisted pageSize', async () => {
  const res = await fetch(`${base}/api/ge/flips?pageSize=999`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as { pageSize: number };
  assert.equal(data.pageSize, 50);
});

test('/api/ge/flips ids= bypasses filters and drops non-integer entries', async () => {
  const res = await fetch(`${base}/api/ge/flips?ids=${ITEM_ID},notanumber&minVolume=999999999`);
  assert.equal(res.status, 200);
  const data = (await res.json()) as { items: { id: number }[] };
  assert.deepEqual(data.items.map((i) => i.id), [ITEM_ID]);
});

// `?limit=-1` used to reach .slice(0, -1), which silently returns the page
// minus its last row - here, with one fixture item, nothing at all.
test('/api/ge/movers clamps limit at both ends', async () => {
  const risersFor = async (query: string): Promise<{ id: number }[]> => {
    const res = await fetch(`${base}/api/ge/movers?${query}`);
    assert.equal(res.status, 200, query);
    const data = (await res.json()) as { risers: { id: number }[] };
    return data.risers;
  };

  assert.equal((await risersFor('limit=-1')).length, 1, 'a negative limit floors to 1');
  assert.equal((await risersFor('limit=0')).length, 1, 'and so does zero');
  assert.equal((await risersFor('limit=1')).length, 1);
  assert.ok((await risersFor('limit=9999')).length <= 50, 'still capped at 50');
});
