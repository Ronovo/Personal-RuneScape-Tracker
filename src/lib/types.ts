// Server-only shapes: what the OSRS Wiki prices API returns, and the options prices.ts takes. Shapes the
// client sees too live in src/shared/types.ts.

import type { Confidence, FlipSort, GeView, MembersFilter, SortDir } from '../shared/types.js';

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

export const MOVERS_SORTS = ['pctChange', 'volume', 'price', 'marginAfterTax', 'profitPerLimit'] as const;
export type MoversSort = typeof MOVERS_SORTS[number];

export interface MoversOptions {
  minVolume?: number;
  minPrice?: number;
  maxPrice?: number;
  maxAgeMinutes?: number;
  hideStale?: boolean;
  membersOnly?: MembersFilter;
  sort?: MoversSort;
  sortDir?: SortDir;
  limit?: number;
  view?: GeView;
  seed?: string;
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
