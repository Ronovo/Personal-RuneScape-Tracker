// The shapes of the JSON this app's own /api/* endpoints return.
//
// The response types themselves live in src/shared/api.ts and are re-exported
// here, so the server modules that build them and the page scripts that render
// them are typed by the same declarations. src/shared/types.ts holds the
// prices-side unions the two sides also share. What is left below is genuinely
// browser-only: the movers/search/item-detail view shapes the GE and Flip pages
// consume.

import type { MembersFilter, PriceRange, Confidence, SortDir, FlipSort, FlipItem } from '../shared/types.js';
import { FLIP_SORTS } from '../shared/types.js';

export type { MembersFilter, PriceRange, Confidence, SortDir, FlipSort, FlipItem };
export { FLIP_SORTS };

export type {
  SkillEntry, ScoredEntry, HiscoresData,
  QuestState, QuestKind, QuestWithMeta, QuestSummary, QuestProgressData,
  CollectionItem, CollectionCategory, CollectionGroup, CollectionLogData,
  DiaryTier, DiaryTierProgress, DiaryAreaProgress, DiarySummary, DiaryProgressData,
  CombatAchievementTaskView, CombatAchievementGroup, CombatAchievementSummary, CombatAchievementData,
  CompletedTaskWithMeta, TaskFilterOptions, LeaguesTasksData,
  ApiErrorBody,
} from '../shared/api.js';

// ---- Grand Exchange: movers + search ----

export type GeView = 'risers' | 'fallers' | 'volume' | 'random';

export interface MoverItem {
  id: number;
  name: string;
  members: boolean;
  icon: string;
  currentPrice: number;
  pastPrice: number;
  volume: number;
  pctChange: number;
  pctChange1h: number | null;
  pctChange6h: number | null;
  volume24h: number;
  high: number | null;
  low: number | null;
  buyLimit: number | null;
  marginAfterTax: number | null;
  roi: number | null;
  profitPerLimit: number | null;
  gpPerHour: number | null;
  highTime: number | null;
  lowTime: number | null;
}

export interface MoversResponse {
  // Only the Rising/Dropping views carry these; High Volume and Random rank the
  // unsplit list and return `items` instead.
  risers?: MoverItem[];
  fallers?: MoverItem[];
  items?: MoverItem[];
  consideredCount: number;
}

export interface SearchResult {
  id: number;
  name: string;
  icon: string;
  members: boolean;
  currentPrice: number | null;
  pctChange: number | null;
  volume24h: number;
  marginAfterTax: number | null;
}

// ---- Item detail + chart ----

export interface TimeseriesPoint {
  timestamp: number;
  avgHighPrice: number | null;
  avgLowPrice: number | null;
  highPriceVolume: number | null;
  lowPriceVolume: number | null;
}

export interface ItemDetail {
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
  alchProfit: number | null;
  stale: boolean;
  range: PriceRange;
  rangeHigh: number | null;
  rangeLow: number | null;
  rangeAvg: number | null;
  pctChangeRange: number | null;
  pricePosition: number | null;
  volatility: number | null;
  history: TimeseriesPoint[];
}

// ---- Flip Helper ----

export interface FlipsResponse {
  items: FlipItem[];
  consideredCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

