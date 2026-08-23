// Shapes of the JSON this app's own /api/* endpoints return, as consumed by
// the browser. Mirrors (but is intentionally separate from) src/lib/types.ts
// on the server side — the client build has no dependency on server source.

// ---- Hiscores ----

export interface SkillEntry {
  name: string;
  rank: number | null;
  level: number;
  xp: number;
}

export interface ScoredEntry {
  name: string;
  rank: number | null;
  score: number;
}

export interface HiscoresData {
  username: string;
  combatLevel: number;
  totalLevel: number;
  totalXp: number;
  skills: SkillEntry[];
  bosses: ScoredEntry[];
  minigames: ScoredEntry[];
  others: ScoredEntry[];
}

// ---- Collection log ----

export interface CollectionItem {
  name: string;
  count: number;
  icon: string;
}

export interface CollectionCategory {
  key: string;
  name: string;
  obtained: number;
  total: number;
  items: CollectionItem[];
}

export interface CollectionGroup {
  group: string;
  categories: CollectionCategory[];
}

export interface CollectionLogData {
  username: string;
  lastChecked: string | null;
  itemsObtained: number;
  itemsAvailable: number;
  categoriesFinished: number;
  categoriesAvailable: number;
  hiscoresRank: number | null;
  groups: CollectionGroup[];
}

// ---- Grand Exchange: movers + search ----

export type GeView = 'risers' | 'fallers' | 'penny' | 'random' | 'spread' | 'staircase';

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
  highTime: number | null;
  lowTime: number | null;
}

export interface MoversResponse {
  risers: MoverItem[];
  fallers: MoverItem[];
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

export type PriceRange = '1d' | '1w' | '1m' | '3m' | '1y';

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
// FlipSort / SortDir / MembersFilter mirror src/lib/types.ts — keep in sync by hand.

export type FlipSort =
  | 'profitPerLimit' | 'profit' | 'roi' | 'volume' | 'realisticProfit' | 'margin' | 'confidence'
  | 'name' | 'buy' | 'sell' | 'tax' | 'limit' | 'capital' | 'age';

export const FLIP_SORTS = [
  'profitPerLimit', 'profit', 'roi', 'volume', 'realisticProfit', 'margin', 'confidence',
  'name', 'buy', 'sell', 'tax', 'limit', 'capital', 'age'
] as const satisfies readonly FlipSort[];

export type SortDir = 'asc' | 'desc';

export type MembersFilter = 'all' | 'members' | 'f2p';

export type Confidence = 'high' | 'medium' | 'low';

export interface FlipItem {
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
  affordableUnits?: number;
  realisticProfit?: number;
}

export interface FlipsResponse {
  items: FlipItem[];
  consideredCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---- Errors ----

export interface ApiErrorBody {
  error?: string;
}
