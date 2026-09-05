import { httpError } from './errors.js';
import { fetchWithUserAgent, makeCacheSlot } from './http.js';
import { geTax as computeGeTax } from '../shared/getax.js';
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
export function isTaxExempt(itemName?: string | null): boolean {
  if (!itemName) return false;
  if (TAX_EXEMPT_NAMES.has(itemName)) return true;
  const charged = itemName.match(/^(.*)\(\d+\)$/);
  return Boolean(charged && TAX_EXEMPT_NAMES.has(charged[1]!));
}

// Resolve the exempt flag from the item name, then defer to the shared math
// (src/shared/getax.ts) so the client's geTax stays byte-for-byte identical.
export function geTax(price: number | null | undefined, itemName?: string | null): number {
  return computeGeTax(price, isTaxExempt(itemName));
}

// Unknown/bogus range values fall back to 1 week, so a bad timestep is never requested.
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Realistic gp/hour: after-tax margin scaled by the slower of the 4h buy-limit
// fill rate and the item's share of daily market flow. The divisors are the
// windows those two rates are quoted over - 4 hours for a GE buy limit, 24 for
// daily volume - so both terms come out per hour. For liquid items the
// buy limit dominates (so this tracks profitPerLimit / 4); its real job is
// demoting items whose profitPerLimit looks good but whose thin volume means
// the limit could never actually fill. Divisors are the tuning knobs.
function gpPerHourFrom(
  marginAfterTax: number | null,
  buyLimit: number | null,
  volume24h: number
): number | null {
  if (marginAfterTax == null || marginAfterTax <= 0 || !buyLimit) return null;
  return Math.round(Math.min(buyLimit / 4, volume24h / 24) * marginAfterTax);
}

// Flips buy at low (insta-sell), sell at high (insta-buy), and pay tax on high.
export function spreadFromHighLow(
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

export function dayVolumes(dayEntry: DayEntry | undefined): {
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

// Wiki responses are keyed by string id; callers hold either a number or the
// original string key. Property access coerces a number to its string form, so
// one lookup covers both - the guard here is the nullable object, not the key.
function entry<T>(obj: Record<string, T> | undefined | null, id: number | string): T | undefined {
  return obj ? obj[String(id)] : undefined;
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * One item's slice of mapping + /latest + /24h, plus every value both the GE
 * and Flip views derive from it.
 *
 * The two row builders below are separate on purpose - they filter differently
 * (movers need a 24h-ago price and either side of the book; flips need both
 * sides) and carry different columns, and folding them into one row would mean
 * computing confidence and scores for the GE grid that never shows them. What
 * they genuinely shared was this join and the five derived values hanging off
 * it, which each used to spell out in its own slightly different order.
 */
interface PricedItem {
  /** The raw /latest key, for the sibling blobs that are keyed the same way. */
  key: string;
  id: number;
  name: string;
  members: boolean;
  icon: string;
  /** Insta-buy price: what a flip sells into. */
  high: number | null;
  /** Insta-sell price: what a flip buys at. */
  low: number | null;
  highTime: number | null;
  lowTime: number | null;
  buyLimit: number | null;
  dayEntry: DayEntry | undefined;
  buyVolume24h: number;
  sellVolume24h: number;
  volume24h: number;
  taxExempt: boolean;
  tax: number | null;
  marginAfterTax: number | null;
  roi: number | null;
  profitPerLimit: number | null;
  gpPerHour: number | null;
  /** Seconds since the more recent of the two trade timestamps. */
  age: number | null;
}

function* pricedItems(
  byId: Map<number, MappingItem>,
  latest: LatestPrices,
  day: DayPrices,
  nowSec: number
): Generator<PricedItem> {
  for (const [key, cur] of Object.entries(latest)) {
    const id = Number(key);
    const item = byId.get(id);
    if (!item) continue;

    const high = cur.high ?? null;
    const low = cur.low ?? null;
    const buyLimit = item.limit ?? null;
    const dayEntry = entry(day, key);
    const volumes = dayVolumes(dayEntry);
    const spread = spreadFromHighLow(high, low, buyLimit, item.name);
    const lastTrade = Math.max(cur.highTime ?? 0, cur.lowTime ?? 0);

    yield {
      key,
      id,
      name: item.name,
      members: item.members,
      icon: iconUrl(item.icon),
      high,
      low,
      highTime: cur.highTime ?? null,
      lowTime: cur.lowTime ?? null,
      buyLimit,
      dayEntry,
      ...volumes,
      taxExempt: isTaxExempt(item.name),
      ...spread,
      gpPerHour: gpPerHourFrom(spread.marginAfterTax, buyLimit, volumes.volume24h),
      age: lastTrade ? nowSec - lastTrade : null,
    };
  }
}

// Builds the shared GE view cache. Hourly snapshots drive the 1h/6h % change
// columns; /24h supplies true daily volume.
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

  const nowSec = Math.floor(Date.now() / 1000);
  const joined: JoinedPriceItem[] = [];
  for (const p of pricedItems(byId, latest, day, nowSec)) {
    // A mover needs something to have moved from: no 24h-ago price, no row.
    const past24hEntry = past24h.data[p.key];
    if (!past24hEntry) continue;

    const currentPrice = p.high ?? p.low;
    const pastPrice = past24hEntry.avgHighPrice ?? past24hEntry.avgLowPrice;
    if (!currentPrice || !pastPrice) continue;

    const past1hPrice = past1h.data[p.key]?.avgHighPrice ?? past1h.data[p.key]?.avgLowPrice ?? null;
    const past6hPrice = past6h.data[p.key]?.avgHighPrice ?? past6h.data[p.key]?.avgLowPrice ?? null;

    joined.push({
      id: p.id,
      name: p.name,
      members: p.members,
      icon: p.icon,
      currentPrice,
      pastPrice,
      volume: p.volume24h, // alias so the existing minVolume filter still works
      volume24h: p.volume24h,
      pctChange: ((currentPrice - pastPrice) / pastPrice) * 100,
      pctChange1h: past1hPrice ? ((currentPrice - past1hPrice) / past1hPrice) * 100 : null,
      pctChange6h: past6hPrice ? ((currentPrice - past6hPrice) / past6hPrice) * 100 : null,
      high: p.high,
      low: p.low,
      buyLimit: p.buyLimit,
      marginAfterTax: p.marginAfterTax,
      roi: p.roi,
      profitPerLimit: p.profitPerLimit,
      gpPerHour: p.gpPerHour,
      highTime: p.highTime,
      lowTime: p.lowTime
    });
  }

  moversCache.set(joined);
  return joined;
}

// Filters the joined list and returns rising / falling pages.
// Rising/Dropping still split on the sign of pctChange, then that subset is
// sorted by the requested key so volume/margin sorts the whole set, not just the page.
// High Volume is the same filter+sort over the unsplit list (the client defaults the
// Sort field to volume). Random owns its own seeded ranking, so Sort is inert there
// and the client disables the field to say so.
// sortDir flips the whole comparison rather than being baked into sortValue, so
// every key gets both directions - the same shape as getFlipCandidates. The
// client sends 'asc' for Dropping-by-%-change, which is what makes that view
// lead with the biggest fallers.
// Profit-ranked scans (Penny Arcade / Spread / GP-per-Hour) live on the Flip Helper.
export async function getMovers({
  minVolume = 500,
  minPrice = 50,
  maxPrice = Infinity,
  minMargin = 0,
  minRoi = 0,
  maxAgeMinutes = Infinity,
  hideStale = false,
  membersOnly = 'all',
  sort = 'pctChange',
  sortDir = 'desc',
  limit = 25,
  view = 'risers',
  seed = ''
}: MoversOptions = {}): Promise<MoversResult> {
  const joined = await getJoinedPriceData();
  const nowSec = Math.floor(Date.now() / 1000);
  const maxAgeSeconds = Number.isFinite(maxAgeMinutes) ? maxAgeMinutes * 60 : Infinity;

  const filtered = joined.filter((item) => {
    if (item.volume < minVolume) return false;
    if (item.currentPrice < minPrice) return false;
    if (Number.isFinite(maxPrice) && item.currentPrice > maxPrice) return false;
    if (minMargin && (item.marginAfterTax == null || item.marginAfterTax < minMargin)) return false;
    if (minRoi && (item.roi == null || item.roi < minRoi)) return false;
    if (hideStale || Number.isFinite(maxAgeSeconds)) {
      const last = Math.max(item.highTime ?? 0, item.lowTime ?? 0);
      const cutoff = Math.min(hideStale ? STALE_SECONDS : Infinity, maxAgeSeconds);
      if (!last || nowSec - last > cutoff) return false;
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

  const bySort = (a: JoinedPriceItem, b: JoinedPriceItem): number => {
    const cmp = sortValue(a) - sortValue(b);
    return sortDir === 'desc' ? -cmp : cmp;
  };

  // Rising and Dropping are two halves of one split, so both are built together
  // - the client shows one and the pair costs no more than the sorts it already
  // needs. High Volume and Random rank the unsplit list instead and never read
  // them, so they aren't built (or sent) for those views.
  if (view === 'risers' || view === 'fallers') {
    return {
      risers: filtered.filter((i) => i.pctChange >= 0).sort(bySort).slice(0, limit),
      fallers: filtered.filter((i) => i.pctChange < 0).sort(bySort).slice(0, limit),
      consideredCount: filtered.length,
    };
  }

  // Random owns its ranking; High Volume defers to the Sort field like Rising/Dropping.
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
    case 'volume':
      candidates = filtered.slice().sort(bySort);
      break;
    case 'random':
      candidates = filtered
        .filter((item) => {
          if (item.high == null || item.low == null || item.highTime == null || item.lowTime == null) return false;
          if (item.volume24h < 1_000) return false;
          return nowSec - Math.min(item.highTime, item.lowTime) <= STALE_SECONDS;
        })
        .sort((a, b) => hashForSeed(a) - hashForSeed(b) || a.id - b.id);
      break;
  }

  return { items: candidates.slice(0, limit), consideredCount: candidates.length };
}

// High/low/avg/position/volatility over the selected history window.
// Gaps (null wiki prices) break the point-to-point chain rather than interpolating.
export function rangeStats(history: TimeseriesPoint[], current: number | null): RangeStats {
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
// `range` is normalised by the caller (normalizeRange at the route edge), so
// an unknown value can never reach the timestep lookup below.
export async function getItemDetail(id: number, range: PriceRange = '1w'): Promise<ItemDetail> {
  const cacheKey = `${id}:${range}`;
  const cached = itemDetailCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ITEM_DETAIL_TTL_MS) {
    return cached.data;
  }

  const byId = await getMapping();
  const item = byId.get(id);
  if (!item) {
    throw httpError('Unknown item id', 404);
  }

  const { timestep, keep } = RANGES[range];
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
    range: range,
    ...stats,
    history
  };

  cacheItemDetail(cacheKey, data);
  return data;
}

// Exact name beats prefix beats substring. Used so scanning mapping order
// and stopping at 25 doesn't starve exact matches.
export function matchScore(name: string, q: string): number {
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
    getLatest().catch((): LatestPrices => ({}))
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

const CONFIDENCE_VOLUME_HIGH = 10_000;
const CONFIDENCE_VOLUME_MEDIUM = 1_000;
const CONFIDENCE_AGE_HIGH_SEC = 10 * 60;
const CONFIDENCE_AGE_MEDIUM_SEC = 30 * 60;
// Multiples of the item's own 24h average spread, not percentages: a
// marginVsAvg of 3 means the spread is three times its usual width, which is
// where a price starts looking stale or manipulated rather than tradable.
const CONFIDENCE_MARGIN_HIGH_RATIO = 3;
const CONFIDENCE_MARGIN_MEDIUM_RATIO = 5;

// Plain rule, not an opaque score: high = liquid + fresh + typical margin.
// Tooltip text lists whichever checks failed so the table can explain the dot.
export function describeConfidence(volume: number, age: number | null, marginVsAvg: number | null): ConfidenceInfo {
  const reasons: string[] = [];
  if (volume < CONFIDENCE_VOLUME_HIGH) reasons.push(volume < CONFIDENCE_VOLUME_MEDIUM ? 'low volume' : `volume ${volume.toLocaleString('en-US')}`);
  if (age == null) reasons.push('no recent trade');
  else if (age > CONFIDENCE_AGE_HIGH_SEC) {
    const mins = Math.floor(age / 60);
    reasons.push(mins >= 60 ? `price ${Math.floor(mins / 60)}h old` : `price ${mins}m old`);
  }
  if (marginVsAvg != null && marginVsAvg > CONFIDENCE_MARGIN_HIGH_RATIO) reasons.push('margin unusually wide vs 24h avg');

  if (volume >= CONFIDENCE_VOLUME_HIGH && age != null && age <= CONFIDENCE_AGE_HIGH_SEC && (marginVsAvg == null || marginVsAvg <= CONFIDENCE_MARGIN_HIGH_RATIO)) {
    return { confidence: 'high', confidenceWhy: 'volume ≥ 10k · fresh · typical margin' };
  }
  if (volume >= CONFIDENCE_VOLUME_MEDIUM && age != null && age <= CONFIDENCE_AGE_MEDIUM_SEC && (marginVsAvg == null || marginVsAvg <= CONFIDENCE_MARGIN_MEDIUM_RATIO)) {
    return { confidence: 'medium', confidenceWhy: reasons.length ? reasons.join(' · ') : 'ok volume · reasonably fresh' };
  }
  return { confidence: 'low', confidenceWhy: reasons.length ? reasons.join(' · ') : 'thin or stale' };
}

// A single 0-100 "how good is this flip overall" number, blending the axes a
// flipper eyeballs anyway: return %, gp throughput, liquidity, freshness and
// how trustworthy the current spread looks. Weights sum to 1; they and the
// normalisation ceilings are the tuning knobs for the "Best Overall" preset.
const SCORE_CONFIDENCE: Record<Confidence, number> = { high: 1, medium: 0.5, low: 0.15 };

function flipScore(
  roi: number | null,
  profitPerLimit: number | null,
  volume24h: number,
  age: number | null,
  confidence: Confidence
): number {
  const roiScore = clamp((roi ?? 0) / 10, 0, 1); // 10% ROI = full marks
  const throughputScore = clamp(Math.log10(Math.max(profitPerLimit ?? 1, 1)) / 7, 0, 1); // ~10m/limit
  const volumeScore = clamp(Math.log10(Math.max(volume24h, 1)) / 6, 0, 1); // ~1m/day
  const freshScore = age == null ? 0 : clamp(1 - age / 3600, 0, 1); // fresh within the hour
  const confScore = SCORE_CONFIDENCE[confidence];
  return Math.round(100 * (
    0.28 * roiScore
    + 0.22 * throughputScore
    + 0.20 * volumeScore
    + 0.15 * freshScore
    + 0.15 * confScore
  ));
}

// One join of mapping + latest + /24h, cached 5 min. Filtering/sorting happens per request.
async function getFlipRows(): Promise<FlipRow[]> {
  const cached = flipsRawCache.get();
  if (cached) return cached;

  const [byId, latest, day] = await Promise.all([getMapping(), getLatest(), get24h()]);
  const nowSec = Math.floor(Date.now() / 1000);
  const rows: FlipRow[] = [];

  for (const p of pricedItems(byId, latest, day, nowSec)) {
    // Flipping: buy at the insta-sell price (low), sell at the insta-buy price
    // (high). A one-sided book is not a flip, so both have to be present.
    const buy = p.low;
    const sell = p.high;
    if (!buy || !sell || p.tax === null || p.marginAfterTax === null) continue;

    const margin = sell - buy;
    const capital = p.buyLimit ? buy * p.buyLimit : null;
    const buyPressure = p.volume24h ? p.sellVolume24h / p.volume24h : null;
    const avgHigh = p.dayEntry?.avgHighPrice ?? null;
    const avgLow = p.dayEntry?.avgLowPrice ?? null;
    const avgMargin = avgHigh != null && avgLow != null ? avgHigh - avgLow : null;
    // >>1 means the current spread is much wider than a typical day — often stale/manipulated.
    const marginVsAvg = avgMargin && avgMargin > 0 ? margin / avgMargin : null;
    const { confidence, confidenceWhy } = describeConfidence(p.volume24h, p.age, marginVsAvg);

    rows.push({
      id: p.id,
      name: p.name,
      members: p.members,
      icon: p.icon,
      buy,
      sell,
      margin,
      tax: p.tax,
      taxExempt: p.taxExempt,
      profit: p.marginAfterTax,
      roi: p.roi,
      limit: p.buyLimit,
      profitPerLimit: p.profitPerLimit,
      capital,
      volume24h: p.volume24h,
      buyPressure,
      age: p.age,
      highTime: p.highTime,
      lowTime: p.lowTime,
      marginVsAvg,
      gpPerHour: p.gpPerHour,
      score: flipScore(p.roi, p.profitPerLimit, p.volume24h, p.age, confidence),
      confidence,
      confidenceWhy
    });
  }

  flipsRawCache.set(rows);
  return rows;
}

// How many units the bankroll actually buys, capped by the 4h buy limit.
// Null when no bankroll is set, which is what makes the sort fall back to
// profit-per-limit rather than treating "unknown" as zero.
function affordableUnits(row: FlipRow, bankroll: number | null): number | null {
  if (!bankroll || bankroll <= 0 || !row.buy) return null;
  return Math.min(row.limit ?? 0, Math.floor(bankroll / row.buy));
}

function realisticProfit(row: FlipRow, bankroll: number | null): number | null {
  const units = affordableUnits(row, bankroll);
  return units === null ? null : row.profit * units;
}

function withBankrollColumns(row: FlipRow, bankroll: number | null): FlipItem {
  const units = affordableUnits(row, bankroll);
  return units === null ? { ...row } : { ...row, affordableUnits: units, realisticProfit: row.profit * units };
}

// Ranked flip scanner. `ids` (watchlist / deep-link) bypasses the filters so
// pinned items always come back. Bankroll adds how many you can actually afford.
export async function getFlipCandidates({
  minVolume = 0,
  minPrice = 0,
  maxPrice = Infinity,
  minMargin = 0,
  minRoi = 0,
  minMarginVsAvg = 0,
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
      if (minMarginVsAvg && (r.marginVsAvg == null || r.marginVsAvg < minMarginVsAvg)) return false;
      if (Number.isFinite(maxAgeMinutes) && (r.age == null || r.age > maxAgeMinutes * 60)) return false;
      if (!passesMembersFilter(r.members, membersOnly)) return false;
      if (maxCapital != null && Number.isFinite(maxCapital) && (r.capital == null || r.capital > maxCapital)) return false;
      if (nameQuery && !r.name.toLowerCase().includes(nameQuery)) return false;
      return true;
    });
  }

  function sortValue(item: FlipRow): number {
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
      case 'realisticProfit': return realisticProfit(item, bankroll) ?? item.profitPerLimit ?? -Infinity;
      case 'margin': return item.margin ?? -Infinity;
      case 'marginVsAvg': return item.marginVsAvg ?? -Infinity;
      case 'score': return item.score ?? -Infinity;
      case 'gpPerHour': return item.gpPerHour ?? -Infinity;
      case 'confidence': return CONFIDENCE_RANK[item.confidence];
      default: return item.profitPerLimit ?? -Infinity;
    }
  }

  // 'name' sorts alphabetically (locale-aware); everything else is numeric.
  // sortDir flips the whole comparison rather than being baked into sortValue,
  // so every key gets both directions for free.
  //
  // Sorted in place, over the rows themselves: `filtered` is already a fresh
  // array from .filter(), and sorting references costs nothing per item. The
  // bankroll columns are derived onto the one page that is actually returned
  // rather than onto every candidate - a wide scan is a few thousand rows, and
  // all but fifty of those copies were thrown away.
  filtered.sort((a, b) => {
    const cmp = sort === 'name' ? a.name.localeCompare(b.name) : sortValue(a) - sortValue(b);
    return sortDir === 'desc' ? -cmp : cmp;
  });

  // Clamp defensively: a stale page number (e.g. filters just narrowed the
  // result set out from under it) shouldn't come back empty when page 1 has items.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  return {
    items: filtered.slice(offset, offset + pageSize).map((row) => withBankrollColumns(row, bankroll)),
    consideredCount: filtered.length,
    page: clampedPage,
    pageSize,
    totalPages
  };
}
