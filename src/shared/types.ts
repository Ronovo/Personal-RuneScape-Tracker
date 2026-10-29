// Type unions/shapes that are identical on both sides of the wire.

export const MEMBERS_FILTERS = ['all', 'members', 'f2p'] as const;
export type MembersFilter = typeof MEMBERS_FILTERS[number];
export const PRICE_RANGES = ['1d', '1w', '1m', '3m', '1y'] as const;
export type PriceRange = typeof PRICE_RANGES[number];
export type Confidence = 'high' | 'medium' | 'low';
export type SortDir = 'asc' | 'desc';

export const FLIP_SORTS = [
  'profitPerLimit', 'profit', 'roi', 'volume', 'realisticProfit', 'margin', 'confidence',
  'name', 'buy', 'sell', 'tax', 'limit', 'capital', 'age', 'marginVsAvg', 'score',
  'gpPerHour'
] as const;
export type FlipSort = typeof FLIP_SORTS[number];

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
  // Margin after tax scaled by how fast the buy limit could realistically fill
  // (see gpPerHourFrom); null when there is no positive margin or no buy limit.
  gpPerHour: number | null;
  // 0-100 blend of ROI, throughput, volume, freshness and confidence (see getFlipRows).
  score: number;
  confidence: Confidence;
  confidenceWhy: string;
}

export interface FlipItem extends FlipRow {
  affordableUnits?: number;
  realisticProfit?: number;
}

export const GE_VIEWS = ['risers', 'fallers', 'volume', 'random'] as const;
export type GeView = typeof GE_VIEWS[number];

export interface TimeseriesPoint {
  timestamp: number;
  avgHighPrice: number | null;
  avgLowPrice: number | null;
  highPriceVolume: number | null;
  lowPriceVolume: number | null;
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

export interface MoverItem {
  id: number;
  name: string;
  members: boolean;
  icon: string;
  currentPrice: number;
  pastPrice: number;
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

export interface MoversResult {
  // Only the Rising/Dropping views carry these; High Volume and Random rank the
  // unsplit list and return `items` instead.
  risers?: MoverItem[];
  fallers?: MoverItem[];
  items?: MoverItem[];
  consideredCount: number;
}

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

export interface FlipsResult {
  items: FlipItem[];
  consideredCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
