// Shared server-side shapes: wiki API payloads, and the derived objects
// lib/prices.ts computes from them. Kept here (rather than inline) since
// prices.ts and server.ts (the latter mostly for the query-enum types like
// MembersFilter/MoversSort/FlipSort/SortDir) both reference these. hiscores.ts
// and collectionlog.ts don't import from here - each defines its own local
// request/response shapes instead, since their data doesn't come from the
// wiki prices API this file is centered on.

// ---- OSRS Wiki prices API (https://prices.runescape.wiki/api/v1/osrs) ----

export interface MappingItem {
  id: number;
  name: string;
  members: boolean;
  icon: string;
  limit?: number | null;
  highalch?: number | null;
  lowalch?: number | null;
  examine?: string;
  value?: number;
}

export interface LatestPriceEntry {
  high: number | null;
  highTime?: number | null;
  low: number | null;
  lowTime?: number | null;
}

export type LatestPrices = Record<string, LatestPriceEntry>;

export interface DayEntry {
  avgHighPrice: number | null;
  avgLowPrice: number | null;
  highPriceVolume: number;
  lowPriceVolume: number;
}

export type DayPrices = Record<string, DayEntry>;

export interface TimeseriesPoint {
  timestamp: number;
  avgHighPrice: number | null;
  avgLowPrice: number | null;
  highPriceVolume: number | null;
  lowPriceVolume: number | null;
}

// ---- Common filter enums ----

export type MembersFilter = 'all' | 'members' | 'f2p';
export type PriceRange = '1d' | '1w' | '1m' | '3m' | '1y';

// ---- Movers ("Hot or Not") ----

export type GeView = 'risers' | 'fallers' | 'penny' | 'random' | 'spread' | 'staircase';

export interface JoinedPriceItem {
  id: number;
  name: string;
  members: boolean;
  icon: string;
  currentPrice: number;
  pastPrice: number;
  volume: number;
  volume24h: number;
  pctChange: number;
  pctChange1h: number | null;
  pctChange6h: number | null;
  high: number | null;
  low: number | null;
  buyLimit: number | null;
  marginAfterTax: number | null;
  roi: number | null;
  profitPerLimit: number | null;
  highTime: number | null;
  lowTime: number | null;
}

export type MoversSort = 'pctChange' | 'volume' | 'price' | 'marginAfterTax' | 'profitPerLimit';

export interface MoversOptions {
  minVolume?: number;
  minPrice?: number;
  maxPrice?: number;
  minMargin?: number;
  minRoi?: number;
  hideStale?: boolean;
  membersOnly?: MembersFilter;
  sort?: MoversSort;
  limit?: number;
  view?: GeView;
  seed?: string;
}

export interface MoversResult {
  risers: JoinedPriceItem[];
  fallers: JoinedPriceItem[];
  items?: JoinedPriceItem[];
  consideredCount: number;
}

// ---- Item detail page ----

export interface RangeStats {
  rangeHigh: number | null;
  rangeLow: number | null;
  rangeAvg: number | null;
  pctChangeRange: number | null;
  pricePosition: number | null;
  volatility: number | null;
}

export interface ItemDetail extends RangeStats {
  id: number;
  name: string;
  examine?: string;
  members: boolean;
  icon: string;
  buyLimit: number | null;
  highalch: number | null;
  lowalch: number | null;
  high: number | null;
  highTime: number | null;
  low: number | null;
  lowTime: number | null;
  price24hAgo: number | null;
  pctChange24h: number | null;
  volume24h: number;
  buyVolume24h: number;
  sellVolume24h: number;
  avgHigh24h: number | null;
  avgLow24h: number | null;
  avgMargin24h: number | null;
  margin: number | null;
  tax: number | null;
  taxExempt: boolean;
  marginAfterTax: number | null;
  roi: number | null;
  profitPerLimit: number | null;
  capitalPerLimit: number | null;
  highAge: number | null;
  lowAge: number | null;
  stale: boolean;
  alchProfit: number | null;
  range: PriceRange;
  history: TimeseriesPoint[];
}

// ---- Search ----

export interface SearchResult {
  id: number;
  name: string;
  members: boolean;
  icon: string;
  currentPrice: number | null;
  pctChange: number | null;
  volume24h: number;
  marginAfterTax: number | null;
}

// ---- Flip Helper ----

export type Confidence = 'high' | 'medium' | 'low';

export interface ConfidenceInfo {
  confidence: Confidence;
  confidenceWhy: string;
}

export interface FlipRow {
  id: number;
  name: string;
  members: boolean;
  icon: string;
  buy: number;
  sell: number;
  margin: number;
  tax: number;
  taxExempt: boolean;
  profit: number;
  roi: number | null;
  limit: number | null;
  profitPerLimit: number | null;
  capital: number | null;
  volume24h: number;
  buyPressure: number | null;
  age: number | null;
  highTime: number | null;
  lowTime: number | null;
  marginVsAvg: number | null;
  confidence: Confidence;
  confidenceWhy: string;
}

export interface FlipItem extends FlipRow {
  affordableUnits?: number;
  realisticProfit?: number;
}

export type FlipSort =
  | 'profitPerLimit' | 'profit' | 'roi' | 'volume' | 'realisticProfit' | 'margin' | 'confidence'
  | 'name' | 'buy' | 'sell' | 'tax' | 'limit' | 'capital' | 'age';

export const FLIP_SORTS = [
  'profitPerLimit', 'profit', 'roi', 'volume', 'realisticProfit', 'margin', 'confidence',
  'name', 'buy', 'sell', 'tax', 'limit', 'capital', 'age'
] as const satisfies readonly FlipSort[];

export type SortDir = 'asc' | 'desc';

export interface FlipCandidatesOptions {
  minVolume?: number;
  minPrice?: number;
  maxPrice?: number;
  minMargin?: number; // after-tax profit per unit, not raw spread (unlike movers)
  minRoi?: number;
  maxAgeMinutes?: number;
  membersOnly?: MembersFilter;
  bankroll?: number | null;
  sort?: FlipSort;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
  ids?: number[] | null;
  maxCapital?: number | null;
  name?: string;
}

export interface FlipCandidatesResult {
  items: FlipItem[];
  consideredCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
