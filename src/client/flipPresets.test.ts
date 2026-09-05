/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, PRESETS, PRESET_NOTES, presetFilters } from './flipPresets.js';
import type { PresetName } from './flipPresets.js';
import { FLIP_SORTS } from './types.js';

test('every preset sorts by a key the server accepts', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    const sort = preset.sort ?? DEFAULTS.sort;
    assert.ok(FLIP_SORTS.includes(sort as never), `${name} sorts by an unknown key: ${sort}`);
  }
});

test('presetFilters lays the preset over the defaults', () => {
  const roi = presetFilters('roi');
  assert.equal(roi.minRoi, 3);
  assert.equal(roi.sort, 'roi');
  // Untouched fields fall back to the defaults rather than carrying over
  // whatever the previous preset left in the drawer.
  assert.equal(roi.minPrice, DEFAULTS.minPrice);
  assert.equal(roi.maxPrice, DEFAULTS.maxPrice);
  assert.equal(roi.minMarginVsAvg, DEFAULTS.minMarginVsAvg);
});

test('Penny Arcade scans cheap, heavily traded items by throughput', () => {
  const penny = presetFilters('penny');
  assert.equal(penny.maxPrice, 1000);
  assert.equal(penny.minVolume, 100000);
  assert.equal(penny.sort, 'gpPerHour');
});

test('Watchlist adds no filters of its own', () => {
  assert.deepEqual(presetFilters('watchlist'), { ...DEFAULTS });
});

// The toolbar grid is sized for exactly six presets plus Watchlist, so the key
// list is pinned: High Volume moved to the Grand Exchange and Widening Spread
// was dropped (still reachable by hand via Min. margin vs avg + the x-avg sort).
test('the preset list is exactly the six scan methods plus Watchlist', () => {
  assert.ok(!('volume' in PRESETS));
  assert.ok(!('widening' in PRESETS));
  const names: PresetName[] = ['penny', 'margin', 'roi', 'gpPerHour', 'composite', 'bankroll', 'watchlist'];
  assert.deepEqual(Object.keys(PRESETS), names);
});

// The heading shows this beside the preset name, so it has to stay short - a
// sentence would wrap the heading or get truncated.
test('every preset has a short descriptor', () => {
  for (const name of Object.keys(PRESETS)) {
    const note = PRESET_NOTES[name as keyof typeof PRESET_NOTES];
    assert.ok(note, `${name} has no descriptor`);
    assert.ok(note.trim().split(/\s+/).length <= 4, `${name} descriptor is too wordy: "${note}"`);
    assert.ok(note.length <= 24, `${name} descriptor is too long: "${note}"`);
  }
});
