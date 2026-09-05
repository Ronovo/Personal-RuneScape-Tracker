// Achievement diary tier completion comes from the Leagues Tasks plugin sync,
// not Jagex - the plugin reads tier-complete varbits when the user syncs.

import { requireSection, requireSyncedFile } from './syncedSection.js';
import { titleCaseSlug } from './text.js';
import type { DiaryProgress, DiaryTier } from './sync.js';
import type {
  DiaryAreaProgress, DiaryProgressData, DiarySummary, DiaryTierProgress
} from '../shared/api.js';

export type { DiaryAreaProgress, DiaryProgressData, DiarySummary, DiaryTierProgress };

const TIER_ORDER: DiaryTier[] = ['EASY', 'MEDIUM', 'HARD', 'ELITE'];

const AREA_DISPLAY_NAMES: Record<string, string> = {
  LUMBRIDGE_DRAYNOR: 'Lumbridge & Draynor',
  KOUREND_KEBOS: 'Kourend & Kebos',
  WESTERN_PROVINCES: 'Western Provinces',
};

function displayAreaName(area: string): string {
  return AREA_DISPLAY_NAMES[area] ?? titleCaseSlug(area, '_');
}

function tierSort(a: DiaryTier, b: DiaryTier): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
}

export function groupDiaries(entries: DiaryProgress[]): DiaryAreaProgress[] {
  const byArea = new Map<string, DiaryTierProgress[]>();
  for (const entry of entries) {
    const tiers = byArea.get(entry.area) ?? [];
    tiers.push({ tier: entry.tier, complete: entry.complete });
    byArea.set(entry.area, tiers);
  }

  // Resolve the display name once per area rather than twice per comparison.
  return [...byArea.entries()]
    .map(([area, tiers]): DiaryAreaProgress => {
      const sorted = [...tiers].sort((x, y) => tierSort(x.tier, y.tier));
      return {
        area,
        name: displayAreaName(area),
        tiers: sorted,
        complete: sorted.filter((t) => t.complete).length,
        total: sorted.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function summarizeDiaries(areas: DiaryAreaProgress[]): DiarySummary {
  return {
    complete: areas.reduce((sum, a) => sum + a.complete, 0),
    total: areas.reduce((sum, a) => sum + a.total, 0),
  };
}

export async function fetchDiaryProgress(username: string): Promise<DiaryProgressData> {
  const stored = await requireSyncedFile(username, 'No synced achievement diary data for this player.');
  const achievementDiary = requireSection(stored.achievementDiary, 'No synced achievement diary data for this player.');

  const areas = groupDiaries(achievementDiary);
  return {
    username: stored.username,
    syncedAt: stored.syncedAt,
    summary: summarizeDiaries(areas),
    areas,
  };
}
