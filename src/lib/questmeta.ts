// Decodes a RuneLite quest name (all the plugin sync gives us) into the wiki's
// classification for it. The data is scraped offline by
// scripts/scrape-quest-metadata.mjs - see that file for where each field comes
// from and how to refresh it.

import { loadJsonAsset } from './jsonStore.js';

export type { QuestKind } from '../shared/api.js';
import type { QuestKind } from '../shared/api.js';

export interface QuestMeta {
  name: string;
  wikiPage: string;
  kind: QuestKind;
  members: boolean;
}

interface QuestMetadataFile {
  source: string;
  scrapedAt: string;
  quests: QuestMeta[];
}

const metadata: QuestMetadataFile = loadJsonAsset(import.meta.url, 'quest-metadata.json');

const byName = new Map(metadata.quests.map((q) => [q.name.toLowerCase(), q]));

/** Null when the wiki has no entry - usually a quest released since the last scrape. */
export function lookupQuestMeta(runeliteName: string): QuestMeta | null {
  const key = runeliteName.trim().toLowerCase();
  const exact = byName.get(key);
  if (exact) {
    return exact;
  }

  // RuneLite sends the ten Recipe for Disaster chapters as
  // "Recipe for Disaster - Evil Dave". The wiki files those as subpages, which
  // the scrape drops, so inherit the parent quest's classification.
  const dash = key.indexOf(' - ');
  return dash > 0 ? byName.get(key.slice(0, dash)) ?? null : null;
}
