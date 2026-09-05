// Sanity checks for the Grand Exchange / Flip Helper math in prices.ts. Not
// an exhaustive suite - the goal is to catch a broken formula (wrong tax
// constant, swapped buy/sell, a filter that lets the wrong rows through)
// across the "happy path" a real page load takes.
//
// Two layers:
//  1. Pure-function tests hit the small formula helpers directly (geTax,
//     spreadFromHighLow, rangeStats, describeConfidence, matchScore,
//     dayVolumes, isTaxExempt) with hand-picked numbers.
//  2. Integration tests stub global fetch with a small synthetic price feed
//     and run the real getMovers/getItemDetail/searchItems/getFlipCandidates
//     pipelines end to end, checking both which rows come back and their
//     computed numbers.
//
// Where a numeric "expected" value isn't a clean round number, it's written
// as the same formula applied to the fixture's raw inputs (e.g.
// `((sell - tax - buy) / buy) * 100`) rather than a hand-typed decimal, so a
// transcription slip doesn't produce a false failure.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRange, isTaxExempt, geTax, spreadFromHighLow, dayVolumes,
  rangeStats, matchScore, describeConfidence,
  getMovers, getItemDetail, searchItems, getFlipCandidates
} from './prices.js';
import type { TimeseriesPoint } from './types.js';

// ---------------------------------------------------------------------------
// 1. Pure formula checks
// ---------------------------------------------------------------------------

test('normalizeRange falls back to 1w for anything unrecognized', () => {
  assert.equal(normalizeRange('1d'), '1d');
  assert.equal(normalizeRange('1y'), '1y');
  assert.equal(normalizeRange('bogus'), '1w');
  assert.equal(normalizeRange(undefined), '1w');
  assert.equal(normalizeRange(42), '1w');
});

test('isTaxExempt matches exact names and charged/dosed variants', () => {
  assert.equal(isTaxExempt('Lobster'), true);
  assert.equal(isTaxExempt('Energy potion(4)'), true); // charged variant strips the (N)
  assert.equal(isTaxExempt('Rune scimitar'), false);
  assert.equal(isTaxExempt(null), false);
  assert.equal(isTaxExempt(undefined), false);
});

test('geTax: 2% floored, exempt items pay nothing, cheap sales floor to 0, tax caps at 5m', () => {
  assert.equal(geTax(15000, 'Rune scimitar'), 300);
  assert.equal(geTax(15000, 'Lobster'), 0); // exempt
  assert.equal(geTax(49, 'Rune scimitar'), 0); // floor(49*0.02) = 0
  assert.equal(geTax(50, 'Rune scimitar'), 1); // floor(50*0.02) = 1, first gp of tax
  assert.equal(geTax(300_000_000, 'Rune scimitar'), 5_000_000); // floor(6m) capped to 5m
  assert.equal(geTax(0, 'Rune scimitar'), 0);
  assert.equal(geTax(null, 'Rune scimitar'), 0);
});

test('spreadFromHighLow: normal spread, exempt item, and null propagation', () => {
  const normal = spreadFromHighLow(15000, 14500, 100, 'Rune scimitar');
  assert.equal(normal.tax, 300);
  assert.equal(normal.marginAfterTax, 15000 - 300 - 14500);
  assert.equal(normal.roi, ((15000 - 300 - 14500) / 14500) * 100);
  assert.equal(normal.profitPerLimit, (15000 - 300 - 14500) * 100);

  const exempt = spreadFromHighLow(15000, 14500, 100, 'Lobster');
  assert.equal(exempt.tax, 0);
  assert.equal(exempt.marginAfterTax, 500);
  assert.equal(exempt.profitPerLimit, 50000);

  assert.deepEqual(spreadFromHighLow(null, 14500, 100, 'x'), {
    tax: null, marginAfterTax: null, roi: null, profitPerLimit: null
  });

  const noLow = spreadFromHighLow(15000, null, 100, 'x');
  assert.equal(noLow.tax, 300); // tax only depends on the sell price
  assert.equal(noLow.marginAfterTax, null);
  assert.equal(noLow.roi, null);
  assert.equal(noLow.profitPerLimit, null);

  const noLimit = spreadFromHighLow(15000, 14500, null, 'x');
  assert.equal(noLimit.marginAfterTax, 200);
  assert.equal(noLimit.profitPerLimit, null); // no buy limit -> no per-limit profit

  // A zero (not missing) low price is falsy, so ROI - which would divide by
  // it - comes back null instead of Infinity/NaN. marginAfterTax still
  // computes fine since it only needs low !== null.
  const zeroLow = spreadFromHighLow(100, 0, 10, 'x');
  assert.equal(zeroLow.tax, 2);
  assert.equal(zeroLow.marginAfterTax, 98);
  assert.equal(zeroLow.roi, null);
  assert.equal(zeroLow.profitPerLimit, 980);
});

test('dayVolumes sums buy+sell volume and defaults a missing day entry to zero', () => {
  assert.deepEqual(
    dayVolumes({ avgHighPrice: 1, avgLowPrice: 1, highPriceVolume: 6000, lowPriceVolume: 4000 }),
    { buyVolume24h: 6000, sellVolume24h: 4000, volume24h: 10000 }
  );
  assert.deepEqual(dayVolumes(undefined), { buyVolume24h: 0, sellVolume24h: 0, volume24h: 0 });
});

test('matchScore ranks exact > prefix > substring > no match', () => {
  assert.equal(matchScore('Rune Scimitar', 'rune scimitar'), 0); // exact (case-insensitive)
  assert.equal(matchScore('Rune scimitar', 'rune'), 1); // prefix
  assert.equal(matchScore('Attack potion', 'potion'), 2); // substring, not prefix
  assert.equal(matchScore('Attack cape', 'sword'), -1); // no match
});

test('describeConfidence: high/medium/low tiers and their reason text', () => {
  const high = describeConfidence(10000, 60, 1.0);
  assert.equal(high.confidence, 'high');
  assert.equal(high.confidenceWhy, 'volume ≥ 10k · fresh · typical margin');

  // Same volume/margin as above, but the price is 11 minutes old - too
  // stale for "high" (needs <=10m), still fresh enough for "medium" (<=30m).
  const agedOut = describeConfidence(10000, 700, 1.0);
  assert.equal(agedOut.confidence, 'medium');
  assert.equal(agedOut.confidenceWhy, 'price 11m old');

  // Below the 10k "high" bar but above the 1k "medium" bar - falls to
  // medium and explains itself with the exact (thousands-separated) volume.
  const midVolume = describeConfidence(5000, 60, 1);
  assert.equal(midVolume.confidence, 'medium');
  assert.equal(midVolume.confidenceWhy, 'volume 5,000');

  const low = describeConfidence(500, null, 10);
  assert.equal(low.confidence, 'low');
  assert.equal(low.confidenceWhy, 'low volume · no recent trade · margin unusually wide vs 24h avg');
});

test('rangeStats: high/low/avg/position/volatility over a window with a data gap', () => {
  const history: TimeseriesPoint[] = [
    { timestamp: 1, avgHighPrice: 100, avgLowPrice: 90, highPriceVolume: 1, lowPriceVolume: 1 },
    { timestamp: 2, avgHighPrice: 110, avgLowPrice: 100, highPriceVolume: 1, lowPriceVolume: 1 },
    { timestamp: 3, avgHighPrice: null, avgLowPrice: null, highPriceVolume: 0, lowPriceVolume: 0 },
    { timestamp: 4, avgHighPrice: 200, avgLowPrice: 190, highPriceVolume: 1, lowPriceVolume: 1 },
    { timestamp: 5, avgHighPrice: 220, avgLowPrice: 210, highPriceVolume: 1, lowPriceVolume: 1 }
  ];

  const stats = rangeStats(history, 220);
  assert.equal(stats.rangeHigh, 220);
  assert.equal(stats.rangeLow, 100);
  assert.equal(stats.rangeAvg, (100 + 110 + 200 + 220) / 4);
  assert.equal(stats.pctChangeRange, ((220 - 100) / 100) * 100);
  assert.equal(stats.pricePosition, ((220 - 100) / (220 - 100)) * 100); // current sits at the range high -> 100%

  // The gap at timestamp 3 breaks the move chain, so volatility only sees
  // two point-to-point moves: 100->110 and 200->220, both +10%. Equal moves
  // mean zero variance.
  assert.equal(stats.volatility, 0);

  assert.deepEqual(rangeStats([], 100), {
    rangeHigh: null, rangeLow: null, rangeAvg: null,
    pctChangeRange: null, pricePosition: null, volatility: null
  });

  // A single point can't produce a move, so volatility is null even though
  // every other stat is defined (flat range collapses pricePosition to 50).
  const single = rangeStats(
    [{ timestamp: 1, avgHighPrice: 50, avgLowPrice: 40, highPriceVolume: 1, lowPriceVolume: 1 }],
    50
  );
  assert.equal(single.rangeHigh, 50);
  assert.equal(single.pricePosition, 50);
  assert.equal(single.volatility, null);

  // No current price at all -> both range-relative-to-current fields go null.
  const noCurrent = rangeStats(history, null);
  assert.equal(noCurrent.pctChangeRange, null);
  assert.equal(noCurrent.pricePosition, null);
});

// ---------------------------------------------------------------------------
// 2. Integration checks against a synthetic price feed
// ---------------------------------------------------------------------------

const NOW_SEC = Math.floor(Date.now() / 1000);
const DAY_AGO_SEC = NOW_SEC - 86400;

interface Fixture {
  id: number;
  name: string;
  members: boolean;
  limit: number | null;
  highalch?: number;
  high: number | null;
  low: number | null;
  highAgeSec: number;
  lowAgeSec: number;
  day: { avgHigh: number; avgLow: number; buyVol: number; sellVol: number };
  hour1: { avgHigh: number; avgLow: number };
  hour6: { avgHigh: number; avgLow: number };
  hour24: { avgHigh: number; avgLow: number };
}

const FRESH = 60; // 1 minute old
const STALE = 3600; // 1 hour old - past the 30 minute staleness cutoff

// One synthetic "market" shared by every integration test below, so a single
// fetch stub can serve GE movers, item detail, search, and Flip Helper all
// from the same consistent data.
const FIXTURES: Fixture[] = [
  // Rune scimitar: the primary subject for flip-math and item-detail checks.
  // A clear riser (24h-ago price well below current) with fresh, liquid trades.
  {
    id: 1, name: 'Rune scimitar', members: true, limit: 100, highalch: 480,
    high: 15000, low: 14500, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 14800, avgLow: 14300, buyVol: 6000, sellVol: 4000 },
    hour1: { avgHigh: 14700, avgLow: 14200 },
    hour6: { avgHigh: 13800, avgLow: 13300 },
    hour24: { avgHigh: 12500, avgLow: 12000 }
  },
  // Tax-exempt (on the wiki's exempt list) - tax should be 0 despite a
  // healthy sell price, unlike every other row here.
  {
    id: 2, name: 'Lobster', members: false, limit: 1000,
    high: 150, low: 120, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 145, avgLow: 118, buyVol: 20000, sellVol: 18000 },
    hour1: { avgHigh: 148, avgLow: 119 }, hour6: { avgHigh: 146, avgLow: 118 }, hour24: { avgHigh: 140, avgLow: 115 }
  },
  // Expensive enough that 2% would exceed the 5m gp tax cap.
  {
    id: 3, name: 'Party hat', members: false, limit: 2,
    high: 300_000_000, low: 290_000_000, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 298_000_000, avgLow: 289_000_000, buyVol: 10, sellVol: 8 },
    hour1: { avgHigh: 299_000_000, avgLow: 289_500_000 },
    hour6: { avgHigh: 297_000_000, avgLow: 288_000_000 },
    hour24: { avgHigh: 295_000_000, avgLow: 285_000_000 }
  },
  // Cheap + very high volume -> qualifies for the Penny Arcade view.
  {
    id: 4, name: 'Penny item', members: false, limit: 10000,
    high: 500, low: 480, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 490, avgLow: 475, buyVol: 80000, sellVol: 70000 },
    hour1: { avgHigh: 495, avgLow: 478 }, hour6: { avgHigh: 485, avgLow: 470 }, hour24: { avgHigh: 470, avgLow: 460 }
  },
  // Fresh, liquid, positive margin with a buy limit -> qualifies for the
  // GP-per-Hour (velocity) view; also rises at every horizon.
  {
    id: 5, name: 'Climber item', members: true, limit: 50,
    high: 2000, low: 1900, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 1950, avgLow: 1850, buyVol: 2000, sellVol: 1500 },
    hour1: { avgHigh: 1900, avgLow: 1800 }, hour6: { avgHigh: 1700, avgLow: 1600 }, hour24: { avgHigh: 1500, avgLow: 1400 }
  },
  // Wide, fresh, positive margin -> a clean Spread-view candidate.
  {
    id: 6, name: 'Spread item', members: false, limit: 20,
    high: 5000, low: 4000, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 4800, avgLow: 4200, buyVol: 3000, sellVol: 2500 },
    hour1: { avgHigh: 4900, avgLow: 4100 }, hour6: { avgHigh: 4700, avgLow: 4300 }, hour24: { avgHigh: 4600, avgLow: 4400 }
  },
  // Two mutually-fresh, liquid items with no other special property -
  // Random view's only requirements - used to check seeded determinism.
  {
    id: 7, name: 'Random item A', members: false, limit: 5,
    high: 800, low: 750, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 780, avgLow: 760, buyVol: 1200, sellVol: 1100 },
    hour1: { avgHigh: 790, avgLow: 755 }, hour6: { avgHigh: 770, avgLow: 745 }, hour24: { avgHigh: 760, avgLow: 740 }
  },
  {
    id: 8, name: 'Random item B', members: false, limit: 5,
    high: 900, low: 850, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 880, avgLow: 860, buyVol: 1300, sellVol: 1200 },
    hour1: { avgHigh: 890, avgLow: 855 }, hour6: { avgHigh: 870, avgLow: 845 }, hour24: { avgHigh: 860, avgLow: 840 }
  },
  // Last trade over an hour ago - past the 30 minute staleness cutoff, so
  // hideStale should drop it from GE movers.
  {
    id: 9, name: 'Stale item', members: false, limit: 5,
    high: 1000, low: 950, highAgeSec: STALE, lowAgeSec: STALE,
    day: { avgHigh: 980, avgLow: 940, buyVol: 500, sellVol: 400 },
    hour1: { avgHigh: 990, avgLow: 945 }, hour6: { avgHigh: 970, avgLow: 935 }, hour24: { avgHigh: 960, avgLow: 930 }
  },
  // Search ranking trio: an exact match, two "starts with" matches at
  // different volumes (to check the within-tier tie-break), and a
  // substring-only match.
  {
    id: 10, name: 'Dagger', members: false, limit: 25,
    high: 100, low: 90, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 98, avgLow: 88, buyVol: 5000, sellVol: 4000 },
    hour1: { avgHigh: 99, avgLow: 89 }, hour6: { avgHigh: 97, avgLow: 87 }, hour24: { avgHigh: 95, avgLow: 85 }
  },
  {
    id: 11, name: 'Dagger (p)', members: false, limit: 25,
    high: 200, low: 180, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 195, avgLow: 178, buyVol: 3000, sellVol: 2500 },
    hour1: { avgHigh: 198, avgLow: 179 }, hour6: { avgHigh: 190, avgLow: 175 }, hour24: { avgHigh: 185, avgLow: 170 }
  },
  {
    id: 16, name: 'Dagger of speed', members: true, limit: 10,
    high: 300, low: 270, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 290, avgLow: 265, buyVol: 8000, sellVol: 7000 },
    hour1: { avgHigh: 295, avgLow: 268 }, hour6: { avgHigh: 285, avgLow: 260 }, hour24: { avgHigh: 280, avgLow: 255 }
  },
  {
    id: 12, name: 'Bronze dagger', members: false, limit: 25,
    high: 50, low: 40, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 48, avgLow: 38, buyVol: 9000, sellVol: 8000 },
    hour1: { avgHigh: 49, avgLow: 39 }, hour6: { avgHigh: 47, avgLow: 37 }, hour24: { avgHigh: 45, avgLow: 35 }
  },
  // One-sided market (no buy side at all): GE movers can still show a
  // current price (falls back to whichever side exists), but Flip Helper
  // needs both a buy and a sell price, so this must not appear there.
  {
    id: 13, name: 'One-sided item', members: false, limit: 5,
    high: 999, low: null, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 990, avgLow: 0, buyVol: 100, sellVol: 0 },
    hour1: { avgHigh: 995, avgLow: 0 }, hour6: { avgHigh: 992, avgLow: 0 }, hour24: { avgHigh: 900, avgLow: 0 }
  },
  // Nature rune - needed for the high-alch profit column on the item-detail page.
  {
    id: 561, name: 'Nature rune', members: false, limit: 11000,
    high: 180, low: 170, highAgeSec: FRESH, lowAgeSec: FRESH,
    day: { avgHigh: 178, avgLow: 168, buyVol: 500000, sellVol: 480000 },
    hour1: { avgHigh: 179, avgLow: 169 }, hour6: { avgHigh: 177, avgLow: 167 }, hour24: { avgHigh: 175, avgLow: 165 }
  }
];

// Rune scimitar's item-detail test also needs its own price-history window
// (with a gap, to exercise the same "broken move chain" case as the pure
// rangeStats test above, on the real getItemDetail wiring this time).
const RUNE_SCIMITAR_HISTORY: TimeseriesPoint[] = [
  { timestamp: DAY_AGO_SEC - 7200, avgHighPrice: 14000, avgLowPrice: 13900, highPriceVolume: 1, lowPriceVolume: 1 },
  { timestamp: DAY_AGO_SEC, avgHighPrice: 14200, avgLowPrice: 14100, highPriceVolume: 1, lowPriceVolume: 1 },
  { timestamp: DAY_AGO_SEC + 3600, avgHighPrice: null, avgLowPrice: null, highPriceVolume: 0, lowPriceVolume: 0 },
  { timestamp: DAY_AGO_SEC + 7200, avgHighPrice: 14600, avgLowPrice: 14500, highPriceVolume: 1, lowPriceVolume: 1 },
  { timestamp: DAY_AGO_SEC + 10800, avgHighPrice: 15200, avgLowPrice: 15100, highPriceVolume: 1, lowPriceVolume: 1 }
];

function mapping() {
  return FIXTURES.map((f) => ({
    id: f.id, name: f.name, members: f.members, icon: `${f.name}.png`,
    limit: f.limit, highalch: f.highalch ?? null
  }));
}

function latest() {
  const out: Record<string, { high: number | null; highTime: number | null; low: number | null; lowTime: number | null }> = {};
  for (const f of FIXTURES) {
    out[f.id] = {
      high: f.high, highTime: f.high != null ? NOW_SEC - f.highAgeSec : null,
      low: f.low, lowTime: f.low != null ? NOW_SEC - f.lowAgeSec : null
    };
  }
  return out;
}

function day() {
  const out: Record<string, { avgHighPrice: number; avgLowPrice: number; highPriceVolume: number; lowPriceVolume: number }> = {};
  for (const f of FIXTURES) {
    out[f.id] = { avgHighPrice: f.day.avgHigh, avgLowPrice: f.day.avgLow, highPriceVolume: f.day.buyVol, lowPriceVolume: f.day.sellVol };
  }
  return out;
}

function hourSnapshot(pick: (f: Fixture) => { avgHigh: number; avgLow: number }) {
  const out: Record<string, { avgHighPrice: number; avgLowPrice: number }> = {};
  for (const f of FIXTURES) {
    const h = pick(f);
    out[f.id] = { avgHighPrice: h.avgHigh, avgLowPrice: h.avgLow };
  }
  return out;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

// Mirrors the nowHour/hourAgo/sixHoursAgo/dayAgoHour bucketing prices.ts
// computes internally, just to route the stub - not itself under test.
function hourBucket(ts: number): 'hour1' | 'hour6' | 'hour24' | null {
  const nowHour = Math.floor(Date.now() / 1000 / 3600) * 3600;
  if (ts === nowHour - 3600) return 'hour1';
  if (ts === nowHour - 6 * 3600) return 'hour6';
  if (ts === nowHour - 24 * 3600) return 'hour24';
  return null;
}

const originalFetch = globalThis.fetch;

globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);

  if (u.endsWith('/mapping')) return jsonResponse(mapping());
  if (u.endsWith('/latest')) return jsonResponse({ data: latest() });
  if (u.endsWith('/24h')) return jsonResponse({ data: day() });

  if (u.includes('/1h?timestamp=')) {
    const ts = Number(new URL(u).searchParams.get('timestamp'));
    const bucket = hourBucket(ts);
    if (bucket === 'hour1') return jsonResponse({ data: hourSnapshot((f) => f.hour1) });
    if (bucket === 'hour6') return jsonResponse({ data: hourSnapshot((f) => f.hour6) });
    if (bucket === 'hour24') return jsonResponse({ data: hourSnapshot((f) => f.hour24) });
    return jsonResponse({ data: {} });
  }

  if (u.includes('/timeseries')) {
    const id = Number(new URL(u).searchParams.get('id'));
    const history = id === 1 ? RUNE_SCIMITAR_HISTORY : [];
    return jsonResponse({ data: history });
  }

  return new Response('not found', { status: 404 });
}) as typeof fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

// Every "both sides" fixture (a valid buy AND sell price) - what Flip Helper
// requires. Computed here, not hand-counted, so pagination math below can't
// drift out of sync with the fixture list above.
const BOTH_SIDED = FIXTURES.filter((f) => f.high != null && f.low != null);

test('getMovers: pctChange sign buckets risers vs fallers, sorted by pctChange', async () => {
  const result = await getMovers({ minVolume: 0, minPrice: 0, sort: 'pctChange', limit: 50 });
  // Rising/Dropping always carry both buckets; the type is optional only
  // because High Volume and Random omit the split they never show.
  const risers = result.risers ?? [];
  const fallers = result.fallers ?? [];

  // Rune scimitar's 24h-ago price (12500) is below its current price (15000) -> riser.
  const scimitar = risers.find((i) => i.id === 1);
  assert.ok(scimitar, 'Rune scimitar should be a riser');
  assert.equal(scimitar!.pctChange, ((15000 - 12500) / 12500) * 100);
  assert.equal(scimitar!.pctChange1h, ((15000 - 14700) / 14700) * 100);
  assert.equal(scimitar!.pctChange6h, ((15000 - 13800) / 13800) * 100);

  // Risers must come back sorted by pctChange descending.
  for (let i = 1; i < risers.length; i++) {
    assert.ok(risers[i - 1]!.pctChange >= risers[i]!.pctChange);
  }
  assert.ok(risers.every((i) => i.pctChange >= 0));
  assert.ok(fallers.every((i) => i.pctChange < 0));
});

test('getMovers: minVolume/minPrice/maxPrice/minMargin/minRoi/membersOnly narrow the set', async () => {
  const byMinPrice = await getMovers({ minPrice: 1000, minVolume: 0 });
  const consideredIds = new Set([...(byMinPrice.risers ?? []), ...(byMinPrice.fallers ?? [])].map((i) => i.id));
  assert.ok(!consideredIds.has(4)); // Penny item (500gp) is under the floor
  assert.ok(!consideredIds.has(12)); // Bronze dagger (50gp) is under the floor

  const membersOnly = await getMovers({ minVolume: 0, minPrice: 0, membersOnly: 'members' });
  const membersIds = new Set([...(membersOnly.risers ?? []), ...(membersOnly.fallers ?? [])].map((i) => i.id));
  assert.ok([...membersIds].every((id) => FIXTURES.find((f) => f.id === id)!.members));

  const f2pOnly = await getMovers({ minVolume: 0, minPrice: 0, membersOnly: 'f2p' });
  const f2pIds = new Set([...(f2pOnly.risers ?? []), ...(f2pOnly.fallers ?? [])].map((i) => i.id));
  assert.ok([...f2pIds].every((id) => !FIXTURES.find((f) => f.id === id)!.members));
});

test('getMovers: hideStale drops trades older than 30 minutes', async () => {
  const withStale = await getMovers({ minVolume: 0, minPrice: 0, hideStale: false });
  const withoutStale = await getMovers({ minVolume: 0, minPrice: 0, hideStale: true });

  const idsWith = new Set([...(withStale.risers ?? []), ...(withStale.fallers ?? [])].map((i) => i.id));
  const idsWithout = new Set([...(withoutStale.risers ?? []), ...(withoutStale.fallers ?? [])].map((i) => i.id));
  assert.ok(idsWith.has(9)); // Stale item shows up normally
  assert.ok(!idsWithout.has(9)); // ...but not once hideStale is on
});

test('getMovers: High Volume view is the filter row ranked by the Sort field', async () => {
  const byVolume = await getMovers({ view: 'volume', sort: 'volume', minVolume: 0, minPrice: 0, limit: 50 });
  const items = byVolume.items ?? [];
  assert.ok(items.length > 1);
  const volumes = items.map((i) => i.volume24h ?? 0);
  for (let i = 1; i < volumes.length; i++) assert.ok(volumes[i - 1]! >= volumes[i]!);

  // Unlike the retired special views it has no ranking of its own, so the Sort
  // field re-orders it instead of being silently ignored.
  const byPrice = await getMovers({ view: 'volume', sort: 'price', minVolume: 0, minPrice: 0, limit: 50 });
  const prices = (byPrice.items ?? []).map((i) => i.currentPrice ?? 0);
  for (let i = 1; i < prices.length; i++) assert.ok(prices[i - 1]! >= prices[i]!);
  assert.notDeepEqual(items.map((i) => i.id), (byPrice.items ?? []).map((i) => i.id));

  // It also sees the whole filtered set rather than just the rising or falling
  // half, and it does not pay for the split it never shows.
  assert.equal(items.length, byVolume.consideredCount);
  assert.equal(byVolume.risers, undefined);
  assert.equal(byVolume.fallers, undefined);

  // The rising/falling halves of that same filter row do add up to it.
  const split = await getMovers({ view: 'risers', sort: 'volume', minVolume: 0, minPrice: 0, limit: 50 });
  assert.deepEqual(
    new Set(items.map((i) => i.id)),
    new Set([...(split.risers ?? []), ...(split.fallers ?? [])].map((i) => i.id))
  );
});

test('getMovers: sortDir flips every sort key, and defaults to descending', async () => {
  const desc = await getMovers({ minVolume: 0, minPrice: 0, sort: 'price', limit: 50 });
  const asc = await getMovers({ minVolume: 0, minPrice: 0, sort: 'price', sortDir: 'asc', limit: 50 });

  const descPrices = (desc.risers ?? []).map((i) => i.currentPrice ?? 0);
  for (let i = 1; i < descPrices.length; i++) assert.ok(descPrices[i - 1]! >= descPrices[i]!);

  const ascPrices = (asc.risers ?? []).map((i) => i.currentPrice ?? 0);
  for (let i = 1; i < ascPrices.length; i++) assert.ok(ascPrices[i - 1]! <= ascPrices[i]!);

  // Same set either way, just reversed.
  assert.deepEqual(new Set((desc.risers ?? []).map((i) => i.id)), new Set((asc.risers ?? []).map((i) => i.id)));

  // The Dropping view leads with the biggest fallers because the client asks
  // for ascending there, not because getMovers special-cases the bucket.
  const dropping = await getMovers({ minVolume: 0, minPrice: 0, sort: 'pctChange', sortDir: 'asc', limit: 50 });
  const pcts = (dropping.fallers ?? []).map((i) => i.pctChange);
  for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i - 1]! <= pcts[i]!);
});

test('getMovers: maxAgeMinutes drops trades older than the cutoff', async () => {
  const wide = await getMovers({ minVolume: 0, minPrice: 0, maxAgeMinutes: 120 });
  const narrow = await getMovers({ minVolume: 0, minPrice: 0, maxAgeMinutes: 5 });
  const idsWide = new Set([...(wide.risers ?? []), ...(wide.fallers ?? [])].map((i) => i.id));
  const idsNarrow = new Set([...(narrow.risers ?? []), ...(narrow.fallers ?? [])].map((i) => i.id));
  assert.ok(idsWide.has(9)); // Stale item is ~60 min old: inside 120, outside 5
  assert.ok(!idsNarrow.has(9));
});

test('getMovers: Random view is deterministic for a given seed and ignores nothing but freshness/volume', async () => {
  const first = await getMovers({ view: 'random', seed: 'abc', minVolume: 0, minPrice: 0, limit: 50 });
  const second = await getMovers({ view: 'random', seed: 'abc', minVolume: 0, minPrice: 0, limit: 50 });
  assert.deepEqual(
    (first.items ?? []).map((i) => i.id),
    (second.items ?? []).map((i) => i.id)
  ); // same seed -> same order every time

  const freshLiquidIds = new Set(
    FIXTURES.filter((f) => {
      if (f.high == null || f.low == null) return false;
      const volume24h = f.day.buyVol + f.day.sellVol;
      const freshest = Math.max(f.highAgeSec, f.lowAgeSec);
      return volume24h >= 1000 && freshest <= 1800;
    }).map((f) => f.id)
  );
  assert.deepEqual(new Set((first.items ?? []).map((i) => i.id)), freshLiquidIds);
});

test('getItemDetail: full tax/margin/roi/alch/range math for one item', async () => {
  const detail = await getItemDetail(1, '1w');

  assert.equal(detail.high, 15000);
  assert.equal(detail.low, 14500);
  assert.equal(detail.margin, 500);
  assert.equal(detail.tax, 300);
  assert.equal(detail.marginAfterTax, 15000 - 300 - 14500);
  assert.equal(detail.roi, ((15000 - 300 - 14500) / 14500) * 100);
  assert.equal(detail.profitPerLimit, (15000 - 300 - 14500) * 100);
  assert.equal(detail.capitalPerLimit, 14500 * 100);
  assert.equal(detail.taxExempt, false);
  assert.equal(detail.stale, false); // both sides traded a minute ago

  // avgHigh24h/avgLow24h come straight from the /24h entry.
  assert.equal(detail.avgMargin24h, 14800 - 14300);

  // pctChange24h compares current (high) against whichever history point
  // lands closest to "24h ago" - here that's the exact-match point at
  // DAY_AGO_SEC, priced 14200.
  assert.equal(detail.pctChange24h, ((15000 - 14200) / 14200) * 100);

  // High-alch profit = highalch - buy price - nature rune price.
  assert.equal(detail.alchProfit, 480 - 14500 - 180);

  // rangeStats over RUNE_SCIMITAR_HISTORY: prices [14000, 14200, 14600, 15200].
  assert.equal(detail.rangeHigh, 15200);
  assert.equal(detail.rangeLow, 14000);
  assert.equal(detail.rangeAvg, (14000 + 14200 + 14600 + 15200) / 4);
  assert.equal(detail.pctChangeRange, ((15000 - 14000) / 14000) * 100);
});

test('getItemDetail: an old, one-sided or unknown item is handled correctly', async () => {
  const stale = await getItemDetail(9, '1w');
  assert.equal(stale.stale, true); // both sides an hour old, past the 30 minute cutoff

  const oneSided = await getItemDetail(13, '1w');
  assert.equal(oneSided.high, 999);
  assert.equal(oneSided.low, null);
  assert.equal(oneSided.margin, null); // needs both sides
  assert.equal(oneSided.marginAfterTax, null);

  await assert.rejects(getItemDetail(999999, '1w'), /Unknown item id/);
});

test('searchItems: exact beats prefix beats substring, ties broken by volume, case-insensitive', async () => {
  const results = await searchItems('Dagger');
  const ids = results.map((r) => r.id);

  const exactIdx = ids.indexOf(10); // "Dagger"
  const speedIdx = ids.indexOf(16); // "Dagger of speed", 8000 vol
  const pIdx = ids.indexOf(11); // "Dagger (p)", 3000 vol
  const bronzeIdx = ids.indexOf(12); // "Bronze dagger" - substring only

  assert.ok(exactIdx >= 0 && speedIdx >= 0 && pIdx >= 0 && bronzeIdx >= 0);
  assert.ok(exactIdx < speedIdx); // exact match ranks first
  assert.ok(speedIdx < pIdx); // both are "starts with" - higher volume (8000 > 3000) wins the tie
  assert.ok(pIdx < bronzeIdx); // "starts with" beats plain substring

  assert.deepEqual(await searchItems('   '), []);
  assert.deepEqual(await searchItems(''), []);
});

test('getFlipCandidates: buy/sell/margin math, and both-sides-required filters out one-sided markets', async () => {
  const result = await getFlipCandidates({ minVolume: 0, minPrice: 0, pageSize: 50 });
  const scimitar = result.items.find((i) => i.id === 1)!;
  assert.equal(scimitar.buy, 14500);
  assert.equal(scimitar.sell, 15000);
  assert.equal(scimitar.margin, 500);
  assert.equal(scimitar.tax, 300);
  assert.equal(scimitar.profit, 200);
  assert.equal(scimitar.capital, 14500 * 100);

  assert.ok(!result.items.some((i) => i.id === 13)); // one-sided market never appears in Flip Helper
});

test('getFlipCandidates: minMargin uses after-tax profit, minRoi/maxAgeMinutes/membersOnly/maxCapital/name all narrow the set', async () => {
  const cheapOnly = await getFlipCandidates({ maxCapital: 1_000_000, minVolume: 0, minPrice: 0, pageSize: 50 });
  assert.ok(!cheapOnly.items.some((i) => i.id === 3)); // Party hat's capital is ~580m gp

  const freshOnly = await getFlipCandidates({ maxAgeMinutes: 5, minVolume: 0, minPrice: 0, pageSize: 50 });
  assert.ok(!freshOnly.items.some((i) => i.id === 9)); // Stale item traded an hour ago

  const daggersOnly = await getFlipCandidates({ name: 'dagger', minVolume: 0, minPrice: 0, pageSize: 50 });
  assert.deepEqual(
    new Set(daggersOnly.items.map((i) => i.id)),
    new Set([10, 11, 12, 16])
  );

  const membersOnly = await getFlipCandidates({ membersOnly: 'members', minVolume: 0, minPrice: 0, pageSize: 50 });
  assert.ok(membersOnly.items.every((i) => FIXTURES.find((f) => f.id === i.id)!.members));
});

test('getFlipCandidates: ids bypasses every scan filter (watchlist behavior)', async () => {
  const result = await getFlipCandidates({ ids: [9], maxAgeMinutes: 1, minVolume: 1_000_000_000 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.id, 9); // filters that would normally exclude it are skipped
});

test('getFlipCandidates: bankroll affordability clamps by limit OR by what you can afford, whichever is smaller', async () => {
  // 100,000 / 14,500 = 6 affordable units, well under the 100-unit limit.
  const limitedByBankroll = await getFlipCandidates({ ids: [1], bankroll: 100_000 });
  const scimitar = limitedByBankroll.items[0]!;
  assert.equal(scimitar.affordableUnits, Math.floor(100_000 / 14500));
  assert.equal(scimitar.realisticProfit, scimitar.profit * Math.floor(100_000 / 14500));

  // A huge bankroll against Lobster's buy limit of 1000 should clamp to the limit.
  const limitedByLimit = await getFlipCandidates({ ids: [2], bankroll: 100_000_000 });
  const lobster = limitedByLimit.items[0]!;
  assert.equal(lobster.affordableUnits, 1000);
  assert.equal(lobster.realisticProfit, lobster.profit * 1000);
});

test('getFlipCandidates: sorting (ascending/descending, including by name) and pagination', async () => {
  const cheapestFirst = await getFlipCandidates({ sort: 'buy', sortDir: 'asc', minVolume: 0, minPrice: 0, pageSize: 50 });
  for (let i = 1; i < cheapestFirst.items.length; i++) {
    assert.ok(cheapestFirst.items[i - 1]!.buy <= cheapestFirst.items[i]!.buy);
  }

  const alphabetical = await getFlipCandidates({ sort: 'name', sortDir: 'asc', minVolume: 0, minPrice: 0, pageSize: 50 });
  for (let i = 1; i < alphabetical.items.length; i++) {
    assert.ok(alphabetical.items[i - 1]!.name.localeCompare(alphabetical.items[i]!.name) <= 0);
  }

  const pageSize = 5;
  const all = await getFlipCandidates({ minVolume: 0, minPrice: 0, pageSize });
  const expectedTotalPages = Math.max(1, Math.ceil(BOTH_SIDED.length / pageSize));
  assert.equal(all.consideredCount, BOTH_SIDED.length);
  assert.equal(all.totalPages, expectedTotalPages);
  assert.equal(all.items.length, Math.min(pageSize, BOTH_SIDED.length));

  // A page number past the end clamps back to the last real page instead of coming back empty.
  const pastTheEnd = await getFlipCandidates({ minVolume: 0, minPrice: 0, pageSize, page: 999 });
  assert.equal(pastTheEnd.page, expectedTotalPages);
  assert.ok(pastTheEnd.items.length > 0);
});

test('getFlipCandidates: marginVsAvg is current spread over the 24h-average spread, and minMarginVsAvg / sort use it', async () => {
  const all = await getFlipCandidates({ minVolume: 0, minPrice: 0, pageSize: 50 });
  const scimitar = all.items.find((i) => i.id === 1)!;
  const spread = all.items.find((i) => i.id === 6)!;
  // Rune scimitar: raw margin 500, 24h avg margin 14800-14300 = 500 -> exactly 1x.
  assert.equal(scimitar.marginVsAvg, 500 / (14800 - 14300));
  // Spread item: raw margin 1000, 24h avg margin 4800-4200 = 600 -> 1.67x.
  assert.equal(spread.marginVsAvg, 1000 / (4800 - 4200));

  const widening = await getFlipCandidates({ minMarginVsAvg: 1.5, minVolume: 0, minPrice: 0, pageSize: 50 });
  assert.ok(widening.items.some((i) => i.id === 6)); // 1.67x clears the 1.5 bar
  assert.ok(!widening.items.some((i) => i.id === 1)); // 1.0x does not
  assert.ok(widening.items.every((i) => (i.marginVsAvg ?? 0) >= 1.5));

  const sorted = await getFlipCandidates({ sort: 'marginVsAvg', minMarginVsAvg: 1.5, minVolume: 0, minPrice: 0, pageSize: 50 });
  const ratios = sorted.items.map((i) => i.marginVsAvg ?? 0);
  for (let i = 1; i < ratios.length; i++) assert.ok(ratios[i - 1]! >= ratios[i]!);
});

test('getFlipCandidates: score is a 0-100 blend and sorts descending', async () => {
  const result = await getFlipCandidates({ sort: 'score', minVolume: 0, minPrice: 0, pageSize: 50 });
  for (const item of result.items) {
    assert.ok(Number.isInteger(item.score));
    assert.ok(item.score >= 0 && item.score <= 100);
  }
  const scores = result.items.map((i) => i.score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1]! >= scores[i]!);
});

test('getFlipCandidates: gpPerHour is margin after tax throttled by limit fill rate and daily volume', async () => {
  const result = await getFlipCandidates({ sort: 'gpPerHour', minVolume: 0, minPrice: 0, pageSize: 50 });

  for (const item of result.items) {
    if (item.profit <= 0 || item.limit == null) {
      assert.equal(item.gpPerHour, null); // no positive margin or no buy limit -> not rankable
      continue;
    }
    const expected = Math.round(Math.min(item.limit / 4, item.volume24h / 24) * item.profit);
    assert.equal(item.gpPerHour, expected);
  }

  const perHour = result.items.map((i) => i.gpPerHour ?? -Infinity);
  for (let i = 1; i < perHour.length; i++) assert.ok(perHour[i - 1]! >= perHour[i]!);
});
