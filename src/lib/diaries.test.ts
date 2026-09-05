import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDiaries, summarizeDiaries } from './diaries.js';
import type { DiaryProgress } from './sync.js';

test('groupDiaries groups tiers by area and applies display aliases', () => {
  const entries: DiaryProgress[] = [
    { area: 'LUMBRIDGE_DRAYNOR', tier: 'HARD', complete: false },
    { area: 'LUMBRIDGE_DRAYNOR', tier: 'EASY', complete: true },
    { area: 'KARAMJA', tier: 'ELITE', complete: false },
  ];

  const areas = groupDiaries(entries);
  assert.equal(areas.length, 2);

  const lumbridge = areas.find((a) => a.area === 'LUMBRIDGE_DRAYNOR')!;
  assert.equal(lumbridge.name, 'Lumbridge & Draynor');
  assert.deepEqual(lumbridge.tiers.map((t) => t.tier), ['EASY', 'HARD']);
  assert.equal(lumbridge.complete, 1);
  assert.equal(lumbridge.total, 2);

  const karamja = areas.find((a) => a.area === 'KARAMJA')!;
  assert.equal(karamja.tiers.length, 1);
  assert.equal(karamja.tiers[0]?.tier, 'ELITE');
});

test('summarizeDiaries counts completed tiers across areas', () => {
  const areas = groupDiaries([
    { area: 'ARDOUGNE', tier: 'EASY', complete: true },
    { area: 'ARDOUGNE', tier: 'MEDIUM', complete: false },
  ]);
  assert.deepEqual(summarizeDiaries(areas), { complete: 1, total: 2 });
});
