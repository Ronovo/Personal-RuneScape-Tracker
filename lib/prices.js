const BASE = 'https://prices.runescape.wiki/api/v1/osrs';
const USER_AGENT = 'osrs-tracker (personal LAN project)';

// Every 24 Hours, Item Cache Timer
const MAPPING_TTL_MS = 24 * 60 * 60 * 1000;
// Every 5 Minutes, "Hot/Not" join
const MOVERS_TTL_MS = 5 * 60 * 1000;
// Every Minute, for item detail page calls
const ITEM_DETAIL_TTL_MS = 60 * 1000;
// Same 5-minute window as movers - the raw flip join is cheap to re-filter
const FLIPS_TTL_MS = 5 * 60 * 1000;
// Shared /latest and /24h blobs, reused by movers, item detail, search, and flips
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
const RANGES = {
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

// Cache of items so we aren't constantly calling for them
let mappingCache = null; // { at, byId: Map(id -> item) }
let moversCache = null; // { at, joined: [] }
let latestCache = null; // { at, data }
let dayCache = null; // { at, data }
let flipsRawCache = null; // { at, rows }
const itemDetailCache = new Map(); // `${id}:${range}` -> { at, data }

// Charged/dosed mapping names look like "Energy potion(4)" - strip the (N)
// and check the base name against the exempt set.
function isTaxExempt(itemName) {
  if (!itemName) return false;
  if (TAX_EXEMPT_NAMES.has(itemName)) return true;
  const charged = itemName.match(/^(.*)\(\d+\)$/);
  return Boolean(charged && TAX_EXEMPT_NAMES.has(charged[1]));
}

// 2% of sale price, floored, capped at 5m. Exempt items and anything that
// floors to 0 (sales under 50 gp) pay nothing.
export function geTax(price, itemName) {
  if (!price || isTaxExempt(itemName)) return 0;
  return Math.min(Math.floor(price * GE_TAX_RATE), GE_TAX_CAP);
}

// Unknown/bogus range values fall back to 1 week so we never request a bad timestep.
export function normalizeRange(range) {
  return RANGES[range] ? range : '1w';
}

// Make a call to the API
async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Prices API request failed: ${path}`), { statusCode: 502 });
  }
  return res.json();
}

function iconUrl(icon) {
  return `https://oldschool.runescape.wiki/images/${encodeURIComponent(icon.replace(/ /g, '_'))}`;
}

// Rebuilds the item cache if it is stale, or builds it the first time.
async function getMapping() {
  if (mappingCache && Date.now() - mappingCache.at < MAPPING_TTL_MS) {
    return mappingCache.byId;
  }
  const items = await get('/mapping');
  const byId = new Map(items.map((item) => [item.id, item]));
  mappingCache = { at: Date.now(), byId };
  return byId;
}

// Latest insta-buy / insta-sell for every item. Shared across movers, detail, search, flips.
async function getLatest() {
  if (latestCache && Date.now() - latestCache.at < LATEST_TTL_MS) {
    return latestCache.data;
  }
  const json = await get('/latest');
  latestCache = { at: Date.now(), data: json.data };
  return latestCache.data;
}

// True 24h average prices + volumes. Replaces summing the last 24 hourly buckets.
async function get24h() {
  if (dayCache && Date.now() - dayCache.at < DAY_TTL_MS) {
    return dayCache.data;
  }
  const json = await get('/24h');
  dayCache = { at: Date.now(), data: json.data };
  return dayCache.data;
}

// Keyed `${id}:${range}`. Map insertion order is FIFO; drop the oldest when over cap.
function cacheItemDetail(key, data) {
  if (!itemDetailCache.has(key) && itemDetailCache.size >= ITEM_CACHE_MAX) {
    const oldest = itemDetailCache.keys().next().value;
    itemDetailCache.delete(oldest);
  }
  itemDetailCache.set(key, { at: Date.now(), data });
}

// Wiki keys are strings; mapping ids are numbers. Accept either.
function entry(obj, id) {
  if (!obj) return undefined;
  return obj[id] ?? obj[String(id)];
}

function stdev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Builds the "Hot or Not" items cache, or rebuilds if it is stale.
// Uses latest prices vs the same hour timeslot 24 hours ago for % change,
// and /24h for real daily volume.
async function getJoinedPriceData() {
  if (moversCache && Date.now() - moversCache.at < MOVERS_TTL_MS) {
    return moversCache.joined;
  }

  const byId = await getMapping();
  const nowHour = Math.floor(Date.now() / 1000 / 3600) * 3600;
  const dayAgoHour = nowHour - 24 * 3600;

  const [latest, past, day] = await Promise.all([
    getLatest(),
    get(`/1h?timestamp=${dayAgoHour}`),
    get24h()
  ]);

  const joined = [];
  for (const [idStr, cur] of Object.entries(latest)) {
    const id = Number(idStr);
    const item = byId.get(id);
    const pastEntry = past.data[idStr];
    if (!item || !pastEntry) continue;

  const currentPrice = cur.high ?? cur.low;
    const pastPrice = pastEntry.avgHighPrice ?? pastEntry.avgLowPrice;
    if (!currentPrice || !pastPrice) continue;

    const dayEntry = entry(day, idStr);
    const volume24h = (dayEntry?.highPriceVolume ?? 0) + (dayEntry?.lowPriceVolume ?? 0);
    const pctChange = ((currentPrice - pastPrice) / pastPrice) * 100;
    const high = cur.high ?? null;
    const low = cur.low ?? null;
    const tax = high !== null ? geTax(high, item.name) : null;
    const marginAfterTax = high !== null && low !== null && tax !== null ? high - tax - low : null;
    const buyLimit = item.limit ?? null;
    const roi = marginAfterTax !== null && low ? (marginAfterTax / low) * 100 : null;
    const profitPerLimit = marginAfterTax !== null && buyLimit ? marginAfterTax * buyLimit : null;

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

  moversCache = { at: Date.now(), joined };
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
  limit = 20
} = {}) {
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
    if (membersOnly === 'members' && !item.members) return false;
    if (membersOnly === 'f2p' && item.members) return false;
    return true;
  });

  function sortValue(item) {
    switch (sort) {
      case 'volume': return item.volume24h ?? 0;
      case 'price': return item.currentPrice ?? 0;
      case 'marginAfterTax': return item.marginAfterTax ?? -Infinity;
      case 'profitPerLimit': return item.profitPerLimit ?? -Infinity;
      default: return item.pctChange ?? 0;
    }
  }

  function bySort(dir) {
    return (a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (sort === 'pctChange' && dir === 'fallers') return av - bv;
      return bv - av;
    };
  }

  const risers = filtered.filter((i) => i.pctChange >= 0).sort(bySort('risers')).slice(0, limit);
  const fallers = filtered.filter((i) => i.pctChange < 0).sort(bySort('fallers')).slice(0, limit);

  return { risers, fallers, consideredCount: filtered.length };
}

// High/low/avg/position/volatility over the selected history window.
// Gaps (null wiki prices) break the point-to-point chain rather than interpolating.
function rangeStats(history, current) {
  const prices = [];
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
  const first = prices[0];
  const pctChangeRange = current && first ? ((current - first) / first) * 100 : null;
  const span = rangeHigh - rangeLow;
  const pricePosition = current != null && span > 0 ? ((current - rangeLow) / span) * 100 : (current != null ? 50 : null);

  const moves = [];
  let prev = null;
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
export async function getItemDetail(id, range = '1w') {
  const resolved = normalizeRange(range);
  const cacheKey = `${id}:${resolved}`;
  const cached = itemDetailCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ITEM_DETAIL_TTL_MS) {
    return cached.data;
  }

  const byId = await getMapping();
  const item = byId.get(id);
  if (!item) {
    throw Object.assign(new Error('Unknown item id'), { statusCode: 404 });
  }

  const { timestep, keep } = RANGES[resolved];
  const [latest, series, day] = await Promise.all([
    getLatest(),
    get(`/timeseries?id=${id}&timestep=${timestep}`),
    get24h()
  ]);

  const cur = entry(latest, id);
  const history = (series.data ?? []).slice(-keep);
  const nowSec = Math.floor(Date.now() / 1000);
  const dayAgoSec = nowSec - 24 * 3600;

  const past = history.reduce((closest, point) => {
    if (!closest) return point;
    return Math.abs(point.timestamp - dayAgoSec) < Math.abs(closest.timestamp - dayAgoSec) ? point : closest;
  }, null);

  const dayEntry = entry(day, id);
  const buyVolume24h = dayEntry?.highPriceVolume ?? 0;
  const sellVolume24h = dayEntry?.lowPriceVolume ?? 0;
  const volume24h = buyVolume24h + sellVolume24h;
  const avgHigh24h = dayEntry?.avgHighPrice ?? null;
  const avgLow24h = dayEntry?.avgLowPrice ?? null;
  const avgMargin24h = avgHigh24h != null && avgLow24h != null ? avgHigh24h - avgLow24h : null;

  const high = cur?.high ?? null;
  const low = cur?.low ?? null;
  const pastPrice = past ? (past.avgHighPrice ?? past.avgLowPrice) : null;
  const current = high ?? low;

  const taxExempt = isTaxExempt(item.name);
  const tax = high !== null ? geTax(high, item.name) : null;
  const margin = high !== null && low !== null ? high - low : null;
  const marginAfterTax = margin !== null && tax !== null ? high - tax - low : null;
  const roi = marginAfterTax !== null && low ? (marginAfterTax / low) * 100 : null;
  const buyLimit = item.limit ?? null;
  const profitPerLimit = marginAfterTax !== null && buyLimit ? marginAfterTax * buyLimit : null;
  const capitalPerLimit = low !== null && buyLimit ? low * buyLimit : null;

  const highAge = cur?.highTime ? nowSec - cur.highTime : null;
  const lowAge = cur?.lowTime ? nowSec - cur.lowTime : null;
  const ages = [highAge, lowAge].filter((a) => a != null);
  const stale = ages.length === 0 || Math.max(...ages) > STALE_SECONDS;

  const nature = entry(latest, NATURE_RUNE_ID);
  const natureRunePrice = nature?.high ?? nature?.low ?? null;
  const alchProfit = item.highalch != null && low != null && natureRunePrice != null
    ? item.highalch - low - natureRunePrice
    : null;

  const stats = rangeStats(history, current);

  const data = {
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
function matchScore(name, q) {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return -1;
}

// Sorts list on screen based on search results.
// Scores every mapping match, then takes the top 25. Falls back to /latest
// for a price when the item has no /1h (movers) row.
export async function searchItems(query) {
  const byId = await getMapping();
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [joined, latest] = await Promise.all([
    getJoinedPriceData().catch(() => []),
    getLatest().catch(() => ({}))
  ]);
  const priceById = new Map(joined.map((j) => [j.id, j]));

  const results = [];
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
  return results.slice(0, 25).map(({ score, ...rest }) => rest);
}

// Plain rule, not an opaque score: high = liquid + fresh + typical margin.
// Tooltip text lists whichever checks failed so the table can explain the dot.
function describeConfidence(volume, age, marginVsAvg) {
  const reasons = [];
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
async function getFlipRows() {
  if (flipsRawCache && Date.now() - flipsRawCache.at < FLIPS_TTL_MS) {
    return flipsRawCache.rows;
  }

  const [byId, latest, day] = await Promise.all([getMapping(), getLatest(), get24h()]);
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = [];

  for (const [idStr, cur] of Object.entries(latest)) {
    const id = Number(idStr);
    const item = byId.get(id);
    // Flipping: buy at the insta-sell price (low), sell at the insta-buy price (high).
    const buy = cur.low ?? null;
    const sell = cur.high ?? null;
    if (!item || !buy || !sell) continue;

    const margin = sell - buy;
    const tax = geTax(sell, item.name);
    const profit = margin - tax;
    const roi = buy ? (profit / buy) * 100 : null;
    const limit = item.limit ?? null;
    const profitPerLimit = limit ? profit * limit : null;
    const capital = limit ? buy * limit : null;
    const dayEntry = entry(day, idStr);
    const highVol = dayEntry?.highPriceVolume ?? 0;
    const lowVol = dayEntry?.lowPriceVolume ?? 0;
    const volume24h = highVol + lowVol;
    const buyPressure = volume24h ? lowVol / volume24h : null;
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

  flipsRawCache = { at: Date.now(), rows };
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
  limit = 50,
  ids = null,
  maxCapital = null
} = {}) {
  const rows = await getFlipRows();
  const idSet = ids && ids.length ? new Set(ids) : null;

  let filtered;
  if (idSet) {
    filtered = rows.filter((r) => idSet.has(r.id));
  } else {
    filtered = rows.filter((r) => {
      if (r.volume24h < minVolume) return false;
      if (r.buy < minPrice) return false;
      if (Number.isFinite(maxPrice) && r.buy > maxPrice) return false;
      if (r.profit < minMargin) return false;
      if (minRoi && (r.roi == null || r.roi < minRoi)) return false;
      if (Number.isFinite(maxAgeMinutes) && (r.age == null || r.age > maxAgeMinutes * 60)) return false;
      if (membersOnly === 'members' && !r.members) return false;
      if (membersOnly === 'f2p' && r.members) return false;
      if (maxCapital != null && Number.isFinite(maxCapital) && (r.capital == null || r.capital > maxCapital)) return false;
      return true;
    });
  }

  const withBankroll = filtered.map((r) => {
    if (!(bankroll > 0) || !r.buy) return { ...r };
    const affordableUnits = Math.min(r.limit ?? 0, Math.floor(bankroll / r.buy));
    return { ...r, affordableUnits, realisticProfit: r.profit * affordableUnits };
  });

  function sortValue(item) {
    switch (sort) {
      case 'profit': return item.profit ?? -Infinity;
      case 'roi': return item.roi ?? -Infinity;
      case 'volume': return item.volume24h ?? 0;
      case 'realisticProfit': return item.realisticProfit ?? item.profitPerLimit ?? -Infinity;
      case 'margin': return item.margin ?? -Infinity;
      default: return item.profitPerLimit ?? -Infinity;
    }
  }

  withBankroll.sort((a, b) => sortValue(b) - sortValue(a));
  return { items: withBankroll.slice(0, limit), consideredCount: filtered.length };
}
