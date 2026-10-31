import { test } from 'node:test';
import assert from 'node:assert/strict';

const ITEMS = 301;
const now = Math.floor(Date.now() / 1000);
let historyRequests: number[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);
  const ids = Array.from({ length: ITEMS }, (_, i) => i + 1);
  if (u.endsWith('/mapping')) {
    return json(ids.map((id) => ({ id, name: `Item ${id}`, members: false, icon: 'item.png', limit: 10, highalch: 0 })));
  }
  if (u.endsWith('/latest')) {
    return json({ data: Object.fromEntries(ids.map((id) => [id, { high: 100, highTime: now, low: 90, lowTime: now }])) });
  }
  if (u.endsWith('/24h') || u.includes('/1h?timestamp=')) return json({ data: {} });
  const id = /[?&]id=(\d+)/.exec(u);
  if (u.includes('/timeseries?') && id) {
    historyRequests.push(Number(id[1]));
    return json({ data: [] });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const { getItemDetail } = await import('./prices.js');

test('the item page cache keeps the latest 300 items and drops the oldest', async () => {
  for (let id = 1; id <= ITEMS; id++) await getItemDetail(id, '1w');
  historyRequests = [];
  await getItemDetail(ITEMS, '1w');
  assert.deepEqual(historyRequests, []);
  await getItemDetail(2, '1w');
  assert.deepEqual(historyRequests, []);
  await getItemDetail(1, '1w');
  assert.deepEqual(historyRequests, [1]);
});
