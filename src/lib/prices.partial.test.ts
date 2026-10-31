import { test } from 'node:test';
import assert from 'node:assert/strict';

// The wiki price API leaves fields out: an item may trade on one side only, have no buy limit, no 24h average, no
// trade times or no history. Each item here is missing something, and the tests check what the pages get instead.
const now = Math.floor(Date.now() / 1000);

const MAPPING = [
  { id: 1, name: 'Steady', members: false, icon: 'a.png', limit: 100, highalch: 1200 },
  { id: 2, name: 'Sell side', members: false, icon: 'a.png' },
  { id: 3, name: 'Untraded', members: false, icon: 'a.png', limit: 10 },
  { id: 4, name: 'Unmoved', members: false, icon: 'a.png', limit: 10 },
  { id: 5, name: 'Limitless', members: false, icon: 'a.png' },
  { id: 6, name: 'Flat average', members: false, icon: 'a.png', limit: 50 },
  { id: 7, name: 'Unlisted', members: false, icon: 'a.png', limit: 5 },
  { id: 8, name: 'Low only', members: false, icon: 'a.png' },
  { id: 561, name: 'Nature rune', members: false, icon: 'a.png', limit: 18000 },
];

const LATEST = {
  1: { high: 1000, highTime: now - 60, low: 900, lowTime: now - 60 },
  2: { high: null, highTime: null, low: 500, lowTime: now - 120 },
  3: { high: null, highTime: null, low: null, lowTime: null },
  4: { high: 300, highTime: now - 60, low: 250, lowTime: now - 60 },
  5: { high: 2000, highTime: null, low: 1800, lowTime: null },
  6: { high: 120, highTime: now - 60, low: 100, lowTime: now - 60 },
  8: { high: null, highTime: null, low: 70, lowTime: now - 60 },
  561: { high: null, highTime: null, low: 150, lowTime: now - 60 },
};

const DAY = {
  1: { avgHighPrice: 990, avgLowPrice: 905, highPriceVolume: 20000, lowPriceVolume: 20000 },
  2: { avgHighPrice: null, avgLowPrice: 450, highPriceVolume: 0, lowPriceVolume: 600 },
  4: { avgHighPrice: null, avgLowPrice: 290, highPriceVolume: 800, lowPriceVolume: 800 },
  6: { avgHighPrice: 100, avgLowPrice: 100, highPriceVolume: 5000, lowPriceVolume: 5000 },
};

const HOUR_SNAPSHOT = {
  1: { avgHighPrice: 950, avgLowPrice: 900 },
  2: { avgHighPrice: null, avgLowPrice: 400 },
  3: { avgHighPrice: 100, avgLowPrice: 90 },
  4: { avgHighPrice: null, avgLowPrice: null },
};

let dayHasData = true;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.endsWith('/mapping')) return json(MAPPING);
  if (u.endsWith('/latest')) return json({ data: LATEST });
  if (u.endsWith('/24h')) return json(dayHasData ? { data: DAY } : {});
  if (u.includes('/1h?timestamp=')) return json({ data: HOUR_SNAPSHOT });
  if (u.includes('/timeseries?id=2&')) {
    return json({ data: [{ timestamp: now - 24 * 3600, avgHighPrice: null, avgLowPrice: 420, highPriceVolume: 0, lowPriceVolume: 5 }] });
  }
  if (u.includes('/timeseries?')) return json({});
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const { getMovers, getFlipCandidates, getItemDetail, searchItems } = await import('./prices.js');

const ids = (items: { id: number }[]) => items.map((i) => i.id);

test('a mover can be priced from either side, and one with no price or no price a day ago is left out', async () => {
  const risers = (await getMovers({ minVolume: 0, minPrice: 0 })).risers!;
  assert.deepEqual(ids(risers), [2, 1]);
  const sellSide = risers.find((i) => i.id === 2)!;
  assert.deepEqual([sellSide.currentPrice, sellSide.pastPrice], [500, 400]);
});

test('movers missing a margin sort last by margin and by profit per limit', async () => {
  for (const sort of ['marginAfterTax', 'profitPerLimit'] as const) {
    const risers = (await getMovers({ minVolume: 0, minPrice: 0, sort })).risers!;
    assert.deepEqual(ids(risers), [1, 2], sort);
  }
});

test('the mover filters drop thin volume, and staleness reads whichever side traded', async () => {
  assert.deepEqual(ids((await getMovers({ minVolume: 1000, minPrice: 0 })).risers!), [1]);
  assert.deepEqual(ids((await getMovers({ minVolume: 0, minPrice: 0, hideStale: true })).risers!), [2, 1]);
});

test('a flip needs both sides, and an item with no limit, trade times or 24h average still flips with those unknown', async () => {
  const { items } = await getFlipCandidates({ sort: 'buy' });
  assert.deepEqual(ids(items), [5, 1, 4, 6]);
  const limitless = items[0]!;
  assert.deepEqual(
    [limitless.capital, limitless.profitPerLimit, limitless.age, limitless.buyPressure, limitless.marginVsAvg],
    [null, null, null, null, null],
  );
  assert.ok(limitless.score >= 0 && limitless.score <= 100);
  assert.equal(items.find((i) => i.id === 4)!.marginVsAvg, null, 'no 24h insta-buy average');
  assert.equal(items.find((i) => i.id === 6)!.marginVsAvg, null, 'a 24h average spread of 0');
});

test('each flip filter drops the rows that fail it', async () => {
  const scan = async (filters: Parameters<typeof getFlipCandidates>[0]) => ids((await getFlipCandidates({ sort: 'buy', ...filters })).items);
  assert.deepEqual(await scan({ minVolume: 1 }), [1, 4, 6]);
  assert.deepEqual(await scan({ minPrice: 500 }), [5, 1]);
  assert.deepEqual(await scan({ maxPrice: 1500 }), [1, 4, 6]);
  assert.deepEqual(await scan({ minMargin: 50 }), [5, 1]);
  assert.deepEqual(await scan({ minRoi: 10 }), [4, 6]);
  assert.deepEqual(await scan({ minRoi: 18 }), [6]);
});

test('flips missing a value sort last on that column', async () => {
  const missing: [NonNullable<Parameters<typeof getFlipCandidates>[0]>['sort'], number[]][] = [
    ['limit', [5]], ['capital', [5]], ['age', [5]], ['realisticProfit', [5]], ['gpPerHour', [5]], ['profitPerLimit', [5]],
    ['marginVsAvg', [4, 5, 6]],
  ];
  for (const [sort, unknown] of missing) {
    const { items } = await getFlipCandidates({ sort });
    assert.deepEqual(ids(items.slice(-unknown.length)).sort(), unknown, sort);
  }
});

test('a bankroll buys none of an item with no buy limit', async () => {
  const { items } = await getFlipCandidates({ sort: 'realisticProfit', bankroll: 1_000_000 });
  const limitless = items.find((i) => i.id === 5)!;
  assert.deepEqual([limitless.affordableUnits, limitless.realisticProfit], [0, 0]);
});

test('an item page fills in what the API left out', async () => {
  const sellSide = await getItemDetail(2, '1w');
  assert.deepEqual([sellSide.high, sellSide.highTime, sellSide.highAge, sellSide.price24hAgo], [null, null, null, 420]);

  const unlisted = await getItemDetail(7, '1w');
  assert.deepEqual([unlisted.high, unlisted.low, unlisted.highTime, unlisted.lowTime, unlisted.stale], [null, null, null, null, true]);
  assert.deepEqual(unlisted.history, []);

  const steady = await getItemDetail(1, '1w');
  assert.equal(steady.alchProfit, 1200 - 900 - 150, 'nature runes priced from their insta-sell price');
});

test('search prices an item that is not a mover from whichever side last traded', async () => {
  const price = async (q: string) => (await searchItems(q))[0]?.currentPrice;
  assert.equal(await price('limitless'), 2000);
  assert.equal(await price('low only'), 70);
  assert.equal(await price('untraded'), null);
  assert.equal(await price('unlisted'), null);
});

test('a 24h answer with no data reads as no volume', async () => {
  dayHasData = false;
  try {
    const copy = './prices.js?no-day';
    const fresh = (await import(copy)) as typeof import('./prices.js');
    const steady = await fresh.getItemDetail(1, '1m');
    assert.deepEqual([steady.volume24h, steady.avgHigh24h, steady.avgLow24h], [0, null, null]);
  } finally {
    dayHasData = true;
  }
});
