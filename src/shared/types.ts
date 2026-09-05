// Type unions/shapes that are identical on both sides of the wire and were
// previously hand-duplicated in src/lib/types.ts and src/client/types.ts.
// Both of those files re-export everything here, so existing imports of
// FlipSort/SortDir/etc. from './types.js' on either side are unaffected.

export type MembersFilter = 'all' | 'members' | 'f2p';
export type PriceRange = '1d' | '1w' | '1m' | '3m' | '1y';
export type Confidence = 'high' | 'medium' | 'low';
export type SortDir = 'asc' | 'desc';

export type FlipSort =
  | 'profitPerLimit' | 'profit' | 'roi' | 'volume' | 'realisticProfit' | 'margin' | 'confidence'
  | 'name' | 'buy' | 'sell' | 'tax' | 'limit' | 'capital' | 'age' | 'marginVsAvg' | 'score'
  | 'gpPerHour';

export const FLIP_SORTS = [
  'profitPerLimit', 'profit', 'roi', 'volume', 'realisticProfit', 'margin', 'confidence',
  'name', 'buy', 'sell', 'tax', 'limit', 'capital', 'age', 'marginVsAvg', 'score',
  'gpPerHour'
] as const satisfies readonly FlipSort[];

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
