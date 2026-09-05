// Decodes a synced combat achievement varbit slug into the wiki task name and
// boss grouping. Scraped offline by scripts/scrape-combat-achievement-metadata.mjs.

import { loadJsonAsset } from './jsonStore.js';

export interface CombatAchievementMeta {
  slug: string;
  name: string;
  monster: string;
  tier: string;
  type: string;
}

interface CombatAchievementMetadataFile {
  source: string;
  scrapedAt: string;
  tasks: CombatAchievementMeta[];
  unmatched?: string[];
}

const metadata: CombatAchievementMetadataFile = loadJsonAsset(
  import.meta.url,
  'combat-achievement-metadata.json'
);

const bySlug = new Map(metadata.tasks.map((t) => [t.slug, t]));

/** Null when the varbit slug isn't in the scraped list — usually a game update since the last scrape. */
export function lookupCombatAchievementMeta(slug: string): CombatAchievementMeta | null {
  return bySlug.get(slug) ?? null;
}
