// Flip Helper preset table: the scan methods offered by the preset strip.
// Kept apart from flip.ts (which is all top-level DOM wiring) so the filter
// values behind each method can be unit-tested, the way leaguesFilters.ts is.
//
// Every preset is applied over DEFAULTS rather than on top of whatever is
// currently in the drawer, so picking a method always produces the same scan
// (Members is the one exception - see applyPreset in flip.ts).
//
// Six presets, which is what the toolbar grid is sized for. A one-off scan the
// list doesn't cover is still reachable by hand: "Min. margin vs avg" plus the
// x-avg sort is the old Widening Spread preset, for instance.
// Broad market views (Rising, Dropping, High Volume, Random) live on the
// Grand Exchange page; everything here ranks by profit you would actually make.

import type { FlipSort, SortDir, MembersFilter } from './types.js';

export type PresetName =
  | 'penny' | 'margin' | 'roi' | 'gpPerHour' | 'composite' | 'bankroll' | 'watchlist';

export interface FilterValues {
  minVolume?: number | string;
  minPrice?: number | string;
  maxPrice?: number | string;
  minMargin?: number | string;
  minRoi?: number | string;
  minMarginVsAvg?: number | string;
  maxAgeMinutes?: number | string;
  membersOnly?: MembersFilter;
  pageSize?: number | string;
  sort?: FlipSort;
  sortDir?: SortDir;
}

export const DEFAULTS: FilterValues = {
  minVolume: 1000,
  minPrice: 50,
  maxPrice: '',
  minMargin: 0,
  minRoi: 0,
  minMarginVsAvg: '',
  maxAgeMinutes: '',
  membersOnly: 'all',
  pageSize: 50,
  sort: 'profitPerLimit',
  sortDir: 'desc'
};

export const PRESETS: Record<PresetName, FilterValues> = {
  // Cheap, heavily traded items. Capital per flip is tiny and the profit comes
  // from turnover, so rank on realistic throughput rather than the headline
  // ROI% that sub-1k items inflate.
  penny: { maxPrice: 1000, minVolume: 100000, sort: 'gpPerHour' },
  margin: { minMargin: 50000, minVolume: 100, sort: 'profit' },
  roi: { minRoi: 3, minVolume: 10000, sort: 'roi' },
  // Margin after tax scaled by how fast the buy limit could actually fill, so
  // thin daily volume demotes an item however wide its spread looks.
  gpPerHour: { minVolume: 1000, maxAgeMinutes: 30, sort: 'gpPerHour' },
  // One blended 0-100 ranking across ROI, throughput, volume, freshness, confidence.
  composite: { minVolume: 1000, sort: 'score' },
  bankroll: { sort: 'realisticProfit' },
  watchlist: {}
};

// A short phrase for what each method actually looks for, shown beside the
// results heading so the active scan explains itself without hovering a
// tooltip. Keep these to a few words - they share a line with the preset name.
export const PRESET_NOTES: Record<PresetName, string> = {
  penny: 'Cheap, fast trades',
  margin: 'Big profit per item',
  roi: 'Best return on capital',
  gpPerHour: 'Most profit per hour',
  composite: 'Best all-round score',
  bankroll: 'What you can afford',
  watchlist: 'Your starred items'
};

// The full filter set a preset scans with: defaults with the preset laid over them.
export function presetFilters(name: PresetName): FilterValues {
  return { ...DEFAULTS, ...PRESETS[name] };
}
