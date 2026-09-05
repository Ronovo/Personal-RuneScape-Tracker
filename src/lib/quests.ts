// Quest progress comes from the Leagues Tasks plugin sync, not Jagex - the
// hiscores expose a quest-point total but never which quests are done. The
// plugin reads every RuneLite Quest state when the user clicks Sync (never
// automatically, e.g. not on login) and posts it with the rest of its
// snapshot, so this just re-serves what's already on disk, decorated with
// the wiki metadata the plugin can't send (see questmeta.ts).

import { lookupQuestMeta } from './questmeta.js';
import { requireSection, requireSyncedFile } from './syncedSection.js';
import type { QuestProgress } from './sync.js';
import type { QuestProgressData, QuestSummary, QuestWithMeta } from '../shared/api.js';

export type { QuestProgressData, QuestSummary, QuestWithMeta };

// A quest the wiki hasn't been scraped for yet is almost certainly a new
// members quest, and treating it as one keeps it visible under the default
// filters rather than vanishing from every view.
export function withMeta(quest: QuestProgress): QuestWithMeta {
  const meta = lookupQuestMeta(quest.name);
  return { ...quest, kind: meta?.kind ?? 'quest', members: meta?.members ?? true };
}

export function summarize(quests: QuestWithMeta[]): QuestSummary {
  const summary: QuestSummary = {
    complete: 0,
    inProgress: 0,
    notStarted: 0,
    miniquests: 0,
    freeToPlay: 0,
  };

  for (const quest of quests) {
    if (quest.state === 'FINISHED') summary.complete++;
    else if (quest.state === 'IN_PROGRESS') summary.inProgress++;
    else summary.notStarted++;
    if (quest.kind === 'miniquest') summary.miniquests++;
    if (!quest.members) summary.freeToPlay++;
  }

  return summary;
}

export async function fetchQuestProgress(username: string): Promise<QuestProgressData> {
  const stored = await requireSyncedFile(username, 'No synced quest data for this player.');
  const questsRaw = requireSection(stored.quests, 'No synced quest data for this player.');

  const quests = [...questsRaw]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(withMeta);

  return {
    username: stored.username,
    syncedAt: stored.syncedAt,
    summary: summarize(quests),
    quests,
  };
}
