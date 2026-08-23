import { httpError } from './errors.js';
import { fetchWithUserAgent, makeCacheSlot } from './http.js';
import type {
  MappingItem, LatestPrices, DayPrices, DayEntry, TimeseriesPoint,
  PriceRange, JoinedPriceItem, MoversOptions, MoversResult,
  RangeStats, ItemDetail, SearchResult, Confidence, ConfidenceInfo,
  FlipRow, FlipItem, FlipCandidatesOptions, FlipCandidatesResult, MembersFilter
} from './types.js';

const BASE = 'https://prices.runescape.wiki/api/v1/osrs';

// Mapping is 24h (it barely changes). Latest + /24h are shared by movers,
// item detail, search, and flips. Joined movers / raw flip rows refresh
// with those blobs; item detail is keyed per id:range and kept shorter.
const MAPPING_TTL_MS = 24 * 60 * 60 * 1000;
const MOVERS_TTL_MS = 5 * 60 * 1000;
const ITEM_DETAIL_TTL_MS = 60 * 1000;
const FLIPS_TTL_MS = 5 * 60 * 1000;
const LATEST_TTL_MS = 5 * 60 * 1000;
const DAY_TTL_MS = 5 * 60 * 1000;

// Used for GE Tax Calculations. Jagex floors the 2%, then caps at 5m gp.
const GE_TAX_RATE = 0.02;
const GE_TAX_CAP = 5_000_000;
// FIFO cap so the range picker (id:range keys) can't grow without bound
const ITEM_CACHE_MAX = 300;
// Nature rune is item 561; used to compute high-alch profit.
const NATURE_RUNE_ID = 561;
// A price whose last trade is older than this is treated as stale.
const STALE_SECONDS = 30 * 60;

// Wiki timeseries timestep + how many points to keep per range-picker value.
const RANGES: Record<PriceRange, { timestep: string; keep: number }> = {
  '1d': { timestep: '5m', keep: 288 },
  '1w': { timestep: '1h', keep: 168 },
  '1m': { timestep: '6h', keep: 120 },
  '3m': { timestep: '6h', keep: 365 },
  '1y': { timestep: '24h', keep: 365 }
};

// Wiki category "Items exempt from Grand Exchange tax" (45 pages), plus
// charged/dosed variants matched via isTaxExempt().
const TAX_EXEMPT_NAMES = new Set([
  'Ardougne teleport (tablet)', 'Ardougne teleport',
  'Bass', 'Bread', 'Bronze arrow', 'Bronze dart', 'Cake',
  'Camelot teleport (tablet)', 'Camelot teleport',
  'Chisel', 'Civitas illa fortis teleport (tablet)', 'Civitas illa fortis teleport',
  'Cooked chicken', 'Cooked meat', 'Energy potion',
  'Falador teleport (tablet)', 'Falador teleport',
  'Games necklace', 'Gardening trowel', 'Glassblowing pipe', 'Hammer', 'Herring',
  'Iron arrow', 'Iron dart',
  'Kourend castle teleport (tablet)', 'Kourend castle teleport',
  'Lobster', 'Lumbridge teleport (tablet)', 'Lumbridge teleport',
  'Mackerel', 'Meat pie', 'Mind rune', 'Needle', 'Old school bond',
  'Pestle and mortar', 'Pike', 'Rake', 'Ring of dueling', 'Salmon', 'Saw',
  'Secateurs', 'Seed dibber', 'Shears', 'Shrimps', 'Spade',
  'Steel arrow', 'Steel dart',
  'Teleport to house (tablet)', 'Teleport to house',
  'Tuna', 'Varrock teleport (tablet)', 'Varrock teleport',
  'Watering can'
]);

const mappingCache = makeCacheSlot<Map<number, MappingItem>>(MAPPING_TTL_MS);
const moversCache = makeCacheSlot<JoinedPriceItem[]>(MOVERS_TTL_MS);
const latestCache = makeCacheSlot<LatestPrices>(LATEST_TTL_MS);
const dayCache = makeCacheSlot<DayPrices>(DAY_TTL_MS);
const flipsRawCache = makeCacheSlot<FlipRow[]>(FLIPS_TTL_MS);
const itemDetailCache = new Map<string, { at: number; data: ItemDetail }>();

// Charged/dosed mapping names look like "Energy potion(4)" - strip the (N)
// and check the base name against the exempt set.
function isTaxExempt(itemName?: string | null): boolean {
  if (!itemName) return false;
  if (TAX_EXEMPT_NAMES.has(itemName)) return true;
  const charged = itemName.match(/^(.*)\(\d+\)$/);
  return Boolean(charged && TAX_EXEMPT_NAMES.has(charged[1]!));
}

// 2% of sale price, floored, capped at 5m. Exempt items and anything that
// floors to 0 (sales under 50 gp) pay nothing.
function geTax(price: number | null | undefined, itemName?: string | null): number {
  if (!price || isTaxExempt(itemName)) return 0;
  return Math.min(Math.floor(price * GE_TAX_RATE), GE_TAX_CAP);
}

// Unknown/bogus range values fall back to 1 week so we never request a bad timestep.
export function normalizeRange(range: unknown): PriceRange {
  return typeof range === 'string' && range in RANGES ? (range as PriceRange) : '1w';
}

// Wiki GET; 502 on non-OK so callers don't parse error HTML as prices.
async function get<T>(path: string): Promise<T> {
  const res = await fetchWithUserAgent(`${BASE}${path}`);
  if (!res.ok) {
    throw httpError(`Prices API request failed: ${path}`, 502);
  }
  return res.json() as Promise<T>;
}

function iconUrl(icon: string): string {
  return `https://oldschool.runescape.wiki/images/${encodeURIComponent(icon.replace(/ /g, '_'))}`;
}

// Flips buy at low (insta-sell), sell at high (insta-buy), and pay tax on high.
function spreadFromHighLow(
  high: number | null,
  low: number | null,
  buyLimit: number | null,
  itemName: string
): { tax: number | null; marginAfterTax: number | null; roi: number | null; profitPerLimit: number | null } {
  const tax = high !== null ? geTax(high, itemName) : null;
  const marginAfterTax = high !== null && low !== null && tax !== null ? high - tax - low : null;
  const roi = marginAfterTax !== null && low ? (marginAfterTax / low) * 100 : null;
  const profitPerLimit = marginAfterTax !== null && buyLimit ? marginAfterTax * buyLimit : null;
  return { tax, marginAfterTax, roi, profitPerLimit };
}

function passesMembersFilter(members: boolean, filter: MembersFilter): boolean {
  return filter === 'all' || (filter === 'members' ? members : !members);
}

function dayVolumes(dayEntry: DayEntry | undefined): {
  buyVolume24h: number;
  sellVolume24h: number;
  volume24h: number;
} {
  const buyVolume24h = dayEntry?.highPriceVolume ?? 0;
  const sellVolume24h = dayEntry?.lowPriceVolume ?? 0;
  return { buyVolume24h, sellVolume24h, volume24h: buyVolume24h + sellVolume24h };
}

async function getMapping(): Promise<Map<number, MappingItem>> {
  const cached = mappingCache.get();
  if (cached) return cached;
  const items = await get<MappingItem[]>('/mapping');
  const byId = new Map(items.map((item) => [item.id, item]));
  mappingCache.set(byId);
  return byId;
}

// Latest insta-buy / insta-sell for every item. Shared across movers, detail, search, flips.
async function getLatest(): Promise<LatestPrices> {
  const cached = latestCache.get();
  if (cached) return cached;
  const json = await get<{ data: LatestPrices }>('/latest');
  latestCache.set(json.data);
  return json.data;
}

// True 24h average prices + volumes. Replaces summing the last 24 hourly buckets.
async function get24h(): Promise<DayPrices> {
  const cached = dayCache.get();
  if (cached) return cached;
  const json = await get<{ data: DayPrices }>('/24h');
  dayCache.set(json.data);
  return json.data;
}

// Keyed `${id}:${range}`. Map insertion order is FIFO; drop the oldest when over cap.
function cacheItemDetail(key: string, data: ItemDetail): void {
  if (!itemDetailCache.has(key) && itemDetailCache.size >= ITEM_CACHE_MAX) {
    const oldest = itemDetailCache.keys().next().value;
    if (oldest !== undefined) itemDetailCache.delete(oldest);
  }
  itemDetailCache.set(key, { at: Date.now(), data });
}

// Wiki keys are strings; mapping ids are numbers. Accept either.
function entry<T>(obj: Record<string, T> | undefined | null, id: number | string): T | undefined {
  if (!obj) return undefined;
  return obj[id as string] ?? obj[String(id)];
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Builds the shared GE view cache. Hourly snapshots support Staircase;
// /24h supplies true daily volume.
async function getJoinedPriceData(): Promise<JoinedPriceItem[]> {
  const cached = moversCache.get();
  if (cached) return cached;

  const byId = await getMapping();
  const nowHour = Math.floor(Date.now() / 1000 / 3600) * 3600;
  const hourAgo = nowHour - 3600;
  const sixHoursAgo = nowHour - 6 * 3600;
  const dayAgoHour = nowHour - 24 * 3600;

  const [latest, past1h, past6h, past24h, day] = await Promise.all([
    getLatest(),
    get<{ data: DayPrices }>(`/1h?timestamp=${hourAgo}`),
    get<{ data: DayPrices }>(`/1h?timestamp=${sixHoursAgo}`),
    get<{ data: DayPrices }>(`/1h?timestamp=${dayAgoHour}`),
    get24h()
  ]);

  const joined: JoinedPriceItem[] = [];
  for (const [idStr, cur] of Object.entries(latest)) {
    const id = Number(idStr);
    const item = byId.get(id);
    const past24hEntry = past24h.data[idStr];
    if (!item || !past24hEntry) continue;

    const currentPrice = cur.high ?? cur.low;
    const pastPrice = past24hEntry.avgHighPrice ?? past24hEntry.avgLowPrice;
    if (!currentPrice || !pastPrice) continue;

    const past1hPrice = past1h.data[idStr]?.avgHighPrice ?? past1h.data[idStr]?.avgLowPrice ?? null;
    const past6hPrice = past6h.data[idStr]?.avgHighPrice ?? past6h.data[idStr]?.avgLowPrice ?? null;
    const dayEntry = entry(day, idStr);
    const { volume24h } = dayVolumes(dayEntry);
    const pctChange = ((currentPrice - pastPrice) / pastPrice) * 100;
    const pctChange1h = past1hPrice ? ((currentPrice - past1hPrice) / past1hPrice) * 100 : null;
    const pctChange6h = past6hPrice ? ((currentPrice - past6hPrice) / past6hPrice) * 100 : null;
    const high = cur.high ?? null;
    const low = cur.low ?? null;
    const buyLimit = item.limit ?? null;
    const { tax, marginAfterTax, roi, profitPerLimit } = spreadFromHighLow(high, low, buyLimit, item.name);

    joined.push({
      id,
      name: item.name,
      members: item.members,
      icon: iconUrl(item.icon),
      currentPrice,
      pastPrice,
      volume: volume24h, // alias so the existing minVolume filter still works
      volume24h,
      pctChange,
      pctChange1h,
      pctChange6h,
      high,
      low,
      buyLimit,
      marginAfterTax,
      roi,
      profitPerLimit,
      highTime: cur.highTime ?? null,
      lowTime: cur.lowTime ?? null
    });
  }

  moversCache.set(joined);
  return joined;
}

// Filters the joined list and returns rising / falling pages.
// Rising/Dropping still split on the sign of pctChange, then that subset is
// sorted by the requested key so volume/margin sorts the whole set, not just the page.
export async function getMovers({
  minVolume = 500,
  minPrice = 50,
  maxPrice = Infinity,
  minMargin = 0,
  minRoi = 0,
  hideStale = false,
  membersOnly = 'all',
  sort = 'pctChange',
  limit = 25,
  view = 'risers',
  seed = ''
}: MoversOptions = {}): Promise<MoversResult> {
  const joined = await getJoinedPriceData();
  const nowSec = Math.floor(Date.now() / 1000);

  const filtered = joined.filter((item) => {
    if (item.volume < minVolume) return false;
    if (item.currentPrice < minPrice) return false;
    if (Number.isFinite(maxPrice) && item.currentPrice > maxPrice) return false;
    if (minMargin && (item.marginAfterTax == null || item.marginAfterTax < minMargin)) return false;
    if (minRoi && (item.roi == null || item.roi < minRoi)) return false;
    if (hideStale) {
      const last = Math.max(item.highTime ?? 0, item.lowTime ?? 0);
      if (!last || nowSec - last > STALE_SECONDS) return false;
    }
    if (!passesMembersFilter(item.members, membersOnly)) return false;
    return true;
  });

  function sortValue(item: JoinedPriceItem): number {
    switch (sort) {
      case 'volume': return item.volume24h ?? 0;
      case 'price': return item.currentPrice ?? 0;
      case 'marginAfterTax': return item.marginAfterTax ?? -Infinity;
      case 'profitPerLimit': return item.profitPerLimit ?? -Infinity;
      default: return item.pctChange ?? 0;
    }
  }

  function bySort(dir: 'risers' | 'fallers'): (a: JoinedPriceItem, b: JoinedPriceItem) => number {
    return (a: JoinedPriceItem, b: JoinedPriceItem) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (sort === 'pctChange' && dir === 'fallers') return av - bv;
      return bv - av;
    };
  }

  const risers = filtered.filter((i) => i.pctChange >= 0).sort(bySort('risers')).slice(0, limit);
  const fallers = filtered.filter((i) => i.pctChange < 0).sort(bySort('fallers')).slice(0, limit);

  if (view === 'risers' || view === 'fallers') {
    return { risers, fallers, consideredCount: filtered.length };
  }

  // Special views deliberately own their ranking; the regular Sort field
  // still controls Rising and Dropping.
  const freshOnBothSides = (item: JoinedPriceItem): boolean => {
    if (item.high == null || item.low == null || item.highTime == null || item.lowTime == null) return false;
    return nowSec - Math.min(item.highTime, item.lowTime) <= STALE_SECONDS;
  };
  const hashForSeed = (item: JoinedPriceItem): number => {
    let hash = 2166136261;
    for (const char of `${seed}:${item.id}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  let candidates: JoinedPriceItem[];
  switch (view) {
    case 'penny':
      candidates = filtered
        .filter((item) => item.currentPrice <= 1_000 && item.volume24h >= 100_000)
        .sort((a, b) => b.volume24h - a.volume24h);
      break;
    case 'random':
      candidates = filtered
        .filter((item) => item.volume24h >= 1_000 && freshOnBothSides(item))
        .sort((a, b) => hashForSeed(a) - hashForSeed(b) || a.id - b.id);
      break;
    case 'spread':
      candidates = filtered
        .filter((item) => item.volume24h >= 1_000 && freshOnBothSides(item) && (item.marginAfterTax ?? 0) > 0)
        .sort((a, b) => (b.marginAfterTax ?? 0) - (a.marginAfterTax ?? 0));
      break;
    case 'staircase':
      candidates = filtered
        .filter((item) =>
          item.volume24h >= 1_000
          && (item.pctChange1h ?? 0) > 0
          && (item.pctChange6h ?? 0) > 0
          && item.pctChange > 0
        )
        .sort((a, b) =>
          (b.pctChange1h ?? 0) + (b.pctChange6h ?? 0) + b.pctChange
          - ((a.pctChange1h ?? 0) + (a.pctChange6h ?? 0) + a.pctChange)
        );
      break;
  }

  return { risers, fallers, items: candidates.slice(0, limit), consideredCount: candidates.length };
}

// High/low/avg/position/volatility over the selected history window.
// Gaps (null wiki prices) break the point-to-point chain rather than interpolating.
function rangeStats(history: TimeseriesPoint[], current: number | null): RangeStats {
  const prices: number[] = [];
  for (const p of history) {
    const v = p.avgHighPrice ?? p.avgLowPrice;
    if (v != null) prices.push(v);
  }
  if (!prices.length) {
    return {
      rangeHigh: null, rangeLow: null, rangeAvg: null,
      pctChangeRange: null, pricePosition: null, volatility: null
    };
  }
  const rangeHigh = Math.max(...prices);
  const rangeLow = Math.min(...prices);
  const rangeAvg = prices.reduce((s, v) => s + v, 0) / prices.length;
  const first = prices[0]!;
  const pctChangeRange = current && first ? ((current - first) / first) * 100 : null;
  const span = rangeHigh - rangeLow;
  const pricePosition = current != null && span > 0 ? ((current - rangeLow) / span) * 100 : (current != null ? 50 : null);

  const moves: number[] = [];
  let prev: number | null = null;
  for (const p of history) {
    const v = p.avgHighPrice ?? p.avgLowPrice;
    if (v == null) {
      prev = null;
      continue;
    }
    if (prev != null && prev !== 0) moves.push(((v - prev) / prev) * 100);
    prev = v;
  }

  return {
    rangeHigh,
    rangeLow,
    rangeAvg,
    pctChangeRange,
    pricePosition,
    volatility: stdev(moves)
  };
}

// Builds the item details for the individual item pages, including the
// selected timeseries range and flip/alch stats derived from data already in hand.
export async function getItemDetail(id: number, range: string = '1w'): Promise<ItemDetail> {
  const resolved = normalizeRange(range);
  const cacheKey = `${id}:${resolved}`;
  const cached = itemDetailCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ITEM_DETAIL_TTL_MS) {
    return cached.data;
  }

  const byId = await getMapping();
  const item = byId.get(id);
  if (!item) {
    throw httpError('Unknown item id', 404);
  }

  const { timestep, keep } = RANGES[resolved];
  const [latest, series, day] = await Promise.all([
    getLatest(),
    get<{ data: TimeseriesPoint[] }>(`/timeseries?id=${id}&timestep=${timestep}`),
    get24h()
  ]);

  const cur = entry(latest, id);
  const history = (series.data ?? []).slice(-keep);
  const nowSec = Math.floor(Date.now() / 1000);
  const dayAgoSec = nowSec - 24 * 3600;

  const past = history.reduce<TimeseriesPoint | null>((closest, point) => {
    if (!closest) return point;
    return Math.abs(point.timestamp - dayAgoSec) < Math.abs(closest.timestamp - dayAgoSec) ? point : closest;
  }, null);

  const dayEntry = entry(day, id);
  const { buyVolume24h, sellVolume24h, volume24h } = dayVolumes(dayEntry);
  const avgHigh24h = dayEntry?.avgHighPrice ?? null;
  const avgLow24h = dayEntry?.avgLowPrice ?? null;
  const avgMargin24h = avgHigh24h != null && avgLow24h != null ? avgHigh24h - avgLow24h : null;

  const high = cur?.high ?? null;
  const low = cur?.low ?? null;
  const pastPrice = past ? (past.avgHighPrice ?? past.avgLowPrice) : null;
  const current = high ?? low;

  const taxExempt = isTaxExempt(item.name);
  const buyLimit = item.limit ?? null;
  const { tax, marginAfterTax, roi, profitPerLimit } = spreadFromHighLow(high, low, buyLimit, item.name);
  const margin = high !== null && low !== null ? high - low : null;
  const capitalPerLimit = low !== null && buyLimit ? low * buyLimit : null;

  const highAge = cur?.highTime ? nowSec - cur.highTime : null;
  const lowAge = cur?.lowTime ? nowSec - cur.lowTime : null;
  const ages = [highAge, lowAge].filter((a): a is number => a != null);
  const stale = ages.length === 0 || Math.max(...ages) > STALE_SECONDS;

  const nature = entry(latest, NATURE_RUNE_ID);
  const natureRunePrice = nature?.high ?? nature?.low ?? null;
  const alchProfit = item.highalch != null && low != null && natureRunePrice != null
    ? item.highalch - low - natureRunePrice
    : null;

  const stats = rangeStats(history, current);

  const data: ItemDetail = {
    id,
    name: item.name,
    examine: item.examine,
    members: item.members,
    icon: iconUrl(item.icon),
    buyLimit,
    highalch: item.highalch ?? null,
    lowalch: item.lowalch ?? null,
    high,
    highTime: cur?.highTime ?? null,
    low,
    lowTime: cur?.lowTime ?? null,
    price24hAgo: pastPrice,
    pctChange24h: pastPrice && high ? ((high - pastPrice) / pastPrice) * 100 : null,
    volume24h,
    buyVolume24h,
    sellVolume24h,
    avgHigh24h,
    avgLow24h,
    avgMargin24h,
    margin,
    tax,
    taxExempt,
    marginAfterTax,
    roi,
    profitPerLimit,
    capitalPerLimit,
    highAge,
    lowAge,
    stale,
    alchProfit,
    range: resolved,
    ...stats,
    history
  };

  cacheItemDetail(cacheKey, data);
  return data;
}

// Exact name beats prefix beats substring. Used so scanning mapping order
// and stopping at 25 doesn't starve exact matches.
function matchScore(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return -1;
}

// Scores all mapping matches server-side, then returns the top 25 by match
// quality then volume. Falls back to /latest for a price when the item has
// no movers row.
export async function searchItems(query: string): Promise<SearchResult[]> {
  const byId = await getMapping();
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [joined, latest] = await Promise.all([
    getJoinedPriceData().catch(() => [] as JoinedPriceItem[]),
    getLatest().catch(() => ({}) as LatestPrices)
  ]);
  const priceById = new Map(joined.map((j) => [j.id, j]));

  const results: (SearchResult & { score: number })[] = [];
  for (const item of byId.values()) {
    const score = matchScore(item.name, q);
    if (score < 0) continue;
    const priced = priceById.get(item.id);
    const cur = entry(latest, item.id);
    const currentPrice = priced?.currentPrice ?? cur?.high ?? cur?.low ?? null;
    results.push({
      id: item.id,
      name: item.name,
      members: item.members,
      icon: iconUrl(item.icon),
      currentPrice,
      pctChange: priced?.pctChange ?? null,
      volume24h: priced?.volume24h ?? 0,
      marginAfterTax: priced?.marginAfterTax ?? null,
      score
    });
  }

  results.sort((a, b) => a.score - b.score || (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return results.slice(0, 25).map(({ score: _score, ...rest }) => rest);
}

// Used to sort by the Confidence column - high first, same "best result first"
// convention every other flip sort key already follows.
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

// Plain rule, not an opaque score: high = liquid + fresh + typical margin.
// Tooltip text lists whichever checks failed so the table can explain the dot.
function describeConfidence(volume: number, age: number | null, marginVsAvg: number | null): ConfidenceInfo {
  const reasons: string[] = [];
  if (volume < 10000) reasons.push(volume < 1000 ? 'low volume' : `volume ${volume.toLocaleString('en-US')}`);
  if (age == null) reasons.push('no recent trade');
  else if (age > 10 * 60) {
    const mins = Math.floor(age / 60);
    reasons.push(mins >= 60 ? `price ${Math.floor(mins / 60)}h old` : `price ${mins}m old`);
  }
  if (marginVsAvg != null && marginVsAvg > 3) reasons.push('margin unusually wide vs 24h avg');

  if (volume >= 10000 && age != null && age <= 10 * 60 && (marginVsAvg == null || marginVsAvg <= 3)) {
    return { confidence: 'high', confidenceWhy: 'volume ≥ 10k · fresh · typical margin' };
  }
  if (volume >= 1000 && age != null && age <= 30 * 60 && (marginVsAvg == null || marginVsAvg <= 5)) {
    return { confidence: 'medium', confidenceWhy: reasons.length ? reasons.join(' · ') : 'ok volume · reasonably fresh' };
  }
  return { confidence: 'low', confidenceWhy: reasons.length ? reasons.join(' · ') : 'thin or stale' };
}

// One join of mapping + latest + /24h, cached 5 min. Filtering/sorting happens per request.
async function getFlipRows(): Promise<FlipRow[]> {
  const cached = flipsRawCache.get();
  if (cached) return cached;

  const [byId, latest, day] = await Promise.all([getMapping(), getLatest(), get24h()]);
  const nowSec = Math.floor(Date.now() / 1000);
  const rows: FlipRow[] = [];

  for (const [idStr, cur] of Object.entries(latest)) {
    const id = Number(idStr);
    const item = byId.get(id);
    // Flipping: buy at the insta-sell price (low), sell at the insta-buy price (high).
    const buy = cur.low ?? null;
    const sell = cur.high ?? null;
    if (!item || !buy || !sell) continue;

    const limit = item.limit ?? null;
    const margin = sell - buy;
    const spread = spreadFromHighLow(sell, buy, limit, item.name);
    if (spread.tax === null || spread.marginAfterTax === null) continue;
    const tax = spread.tax;
    const profit = spread.marginAfterTax;
    const { roi, profitPerLimit } = spread;
    const capital = limit ? buy * limit : null;
    const dayEntry = entry(day, idStr);
    const { sellVolume24h, volume24h } = dayVolumes(dayEntry);
    const buyPressure = volume24h ? sellVolume24h / volume24h : null;
    const lastTrade = Math.max(cur.highTime ?? 0, cur.lowTime ?? 0);
    const age = lastTrade ? nowSec - lastTrade : null;
    const avgHigh = dayEntry?.avgHighPrice ?? null;
    const avgLow = dayEntry?.avgLowPrice ?? null;
    const avgMargin = avgHigh != null && avgLow != null ? avgHigh - avgLow : null;
    // >>1 means the current spread is much wider than a typical day — often stale/manipulated.
    const marginVsAvg = avgMargin && avgMargin > 0 ? margin / avgMargin : null;
    const { confidence, confidenceWhy } = describeConfidence(volume24h, age, marginVsAvg);

    rows.push({
      id,
      name: item.name,
      members: item.members,
      icon: iconUrl(item.icon),
      buy,
      sell,
      margin,
      tax,
      taxExempt: isTaxExempt(item.name),
      profit,
      roi,
      limit,
      profitPerLimit,
      capital,
      volume24h,
      buyPressure,
      age,
      highTime: cur.highTime ?? null,
      lowTime: cur.lowTime ?? null,
      marginVsAvg,
      confidence,
      confidenceWhy
    });
  }

  flipsRawCache.set(rows);
  return rows;
}

// Ranked flip scanner. `ids` (watchlist / deep-link) bypasses the filters so
// pinned items always come back. Bankroll adds how many you can actually afford.
export async function getFlipCandidates({
  minVolume = 0,
  minPrice = 0,
  maxPrice = Infinity,
  minMargin = 0,
  minRoi = 0,
  maxAgeMinutes = Infinity,
  membersOnly = 'all',
  bankroll = null,
  sort = 'profitPerLimit',
  sortDir = 'desc',
  page = 1,
  pageSize = 50,
  ids = null,
  maxCapital = null,
  name
}: FlipCandidatesOptions = {}): Promise<FlipCandidatesResult> {
  const rows = await getFlipRows();
  const idSet = ids && ids.length ? new Set(ids) : null;
  const nameQuery = name?.trim().toLowerCase() || null;

  let filtered: FlipRow[];
  if (idSet) {
    // Watchlists/deep-links bypass every scan filter so pinned IDs always return.
    filtered = rows.filter((r) => idSet.has(r.id));
  } else {
    filtered = rows.filter((r) => {
      if (r.volume24h < minVolume) return false;
      if (r.buy < minPrice) return false;
      if (Number.isFinite(maxPrice) && r.buy > maxPrice) return false;
      // The UI's minimum profit is after-tax profit per unit, not raw spread.
      if (r.profit < minMargin) return false;
      if (minRoi && (r.roi == null || r.roi < minRoi)) return false;
      if (Number.isFinite(maxAgeMinutes) && (r.age == null || r.age > maxAgeMinutes * 60)) return false;
      if (!passesMembersFilter(r.members, membersOnly)) return false;
      if (maxCapital != null && Number.isFinite(maxCapital) && (r.capital == null || r.capital > maxCapital)) return false;
      if (nameQuery && !r.name.toLowerCase().includes(nameQuery)) return false;
      return true;
    });
  }

  const withBankroll: FlipItem[] = filtered.map((r) => {
    if (!bankroll || bankroll <= 0 || !r.buy) return { ...r };
    const affordableUnits = Math.min(r.limit ?? 0, Math.floor(bankroll / r.buy));
    return { ...r, affordableUnits, realisticProfit: r.profit * affordableUnits };
  });

  function sortValue(item: FlipItem): number {
    switch (sort) {
      case 'buy': return item.buy;
      case 'sell': return item.sell;
      case 'tax': return item.tax;
      case 'limit': return item.limit ?? -Infinity;
      case 'capital': return item.capital ?? -Infinity;
      case 'age': return item.age ?? -Infinity;
      case 'profit': return item.profit ?? -Infinity;
      case 'roi': return item.roi ?? -Infinity;
      case 'volume': return item.volume24h ?? 0;
      case 'realisticProfit': return item.realisticProfit ?? item.profitPerLimit ?? -Infinity;
      case 'margin': return item.margin ?? -Infinity;
      case 'confidence': return CONFIDENCE_RANK[item.confidence];
      default: return item.profitPerLimit ?? -Infinity;
    }
  }

  // 'name' sorts alphabetically (locale-aware); everything else is numeric.
  // sortDir flips the whole comparison rather than being baked into sortValue,
  // so every key gets both directions for free.
  withBankroll.sort((a, b) => {
    const cmp = sort === 'name' ? a.name.localeCompare(b.name) : sortValue(a) - sortValue(b);
    return sortDir === 'desc' ? -cmp : cmp;
  });

  // Clamp defensively: a stale page number (e.g. filters just narrowed the
  // result set out from under it) shouldn't come back empty when page 1 has items.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  return {
    items: withBankroll.slice(offset, offset + pageSize),
    consideredCount: filtered.length,
    page: clampedPage,
    pageSize,
    totalPages
  };
}
