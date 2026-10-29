// Server-side shapes for the wiki prices API: prices.ts's derived objects plus
// app.ts's query-enum types. Shapes identical on the client side live in
// src/shared/types.ts and are re-exported below.

import type {
  MembersFilter, PriceRange, Confidence, SortDir, FlipSort, FlipRow, FlipItem, GeView, TimeseriesPoint, SearchResult,
  MoverItem, MoversResult, RangeStats, ItemDetail, FlipsResult,
} from '../shared/types.js';
import { FLIP_SORTS } from '../shared/types.js';

export type {
  MembersFilter, PriceRange, Confidence, SortDir, FlipSort, FlipRow, FlipItem, GeView, TimeseriesPoint, SearchResult,
  MoverItem, MoversResult, RangeStats, ItemDetail, FlipsResult,
};
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

// ---- Movers ("Hot or Not") ----

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

// ---- Item detail page ----

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
