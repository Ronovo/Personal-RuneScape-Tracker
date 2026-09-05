// Shared server-side shapes for the wiki prices API: prices.ts's derived
// objects plus app.ts's query-enum types. hiscores.ts and collectionlog.ts
// define their own local shapes instead, since their data isn't from this
// API. Shapes identical on the client side (MembersFilter, PriceRange,
// Confidence, SortDir, FlipSort/FLIP_SORTS, FlipRow/FlipItem) live in
// src/shared/types.ts and are re-exported below rather than duplicated.

import type { MembersFilter, PriceRange, Confidence, SortDir, FlipSort, FlipRow, FlipItem } from '../shared/types.js';
import { FLIP_SORTS } from '../shared/types.js';

export type { MembersFilter, PriceRange, Confidence, SortDir, FlipSort, FlipRow, FlipItem };
export { FLIP_SORTS };

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

// ---- Movers ("Hot or Not") ----

export type GeView = 'risers' | 'fallers' | 'volume' | 'random';

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
  // Realistic gp/hour: margin after tax scaled by how fast the buy limit could fill.
  gpPerHour: number | null;
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
  maxAgeMinutes?: number;
  hideStale?: boolean;
  membersOnly?: MembersFilter;
  sort?: MoversSort;
  sortDir?: SortDir;
  limit?: number;
  view?: GeView;
  seed?: string;
}

export interface MoversResult {
  // Only the Rising/Dropping views carry these; High Volume and Random rank the
  // unsplit list and return `items` instead.
  risers?: JoinedPriceItem[];
  fallers?: JoinedPriceItem[];
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

export interface ConfidenceInfo {
  confidence: Confidence;
  confidenceWhy: string;
}

export interface FlipCandidatesOptions {
  minVolume?: number;
  minPrice?: number;
  maxPrice?: number;
  minMargin?: number; // after-tax profit per unit, not raw spread (unlike movers)
  minRoi?: number;
  minMarginVsAvg?: number; // current margin / this item's own avg 24h margin
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
