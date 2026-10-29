// Combat achievement progress comes from the Ronovo's Sync Tool plugin sync - the
// plugin reads CA task varbits and total points when the user syncs.

import { lookupCombatAchievementMeta } from './combatachievementmeta.js';
import { titleCaseSlug } from './text.js';
import { requireSyncedSection } from './syncedSection.js';
import { loadJsonAsset } from './jsonStore.js';

// The words a combat achievement slug can end in before its index; shared with the metadata scraper.
const TYPE_TOKENS = new Set(loadJsonAsset<string[]>(import.meta.url, 'combat-achievement-types.json'));
import type { CombatAchievementTask } from './sync.js';
import type {
  CombatAchievementData, CombatAchievementGroup, CombatAchievementSummary,
  CombatAchievementTaskView
} from '../shared/api.js';


function taskGroupKey(task: string): string {
  const idx = task.indexOf('_');
  return idx > 0 ? task.slice(0, idx) : task;
}

// Keep in sync with TYPE_RE in scripts/scrape-combat-achievement-metadata.mjs,
// which uses the same token list to build the metadata this falls back from.
function parseTaskPrefix(task: string): string | null {
  const parts = task.split('_');
  const index = Number(parts.at(-1));
  const typeToken = parts.at(-2);
  if (!Number.isInteger(index) || index < 1 || !typeToken) return null;
  if (!TYPE_TOKENS.has(typeToken.toUpperCase())) {
    return null;
  }
  return parts.slice(0, -2).join('_');
}

export function withTaskView(task: CombatAchievementTask): CombatAchievementTaskView {
  const meta = lookupCombatAchievementMeta(task.task);
  if (meta) {
    return {
      task: task.task,
      name: meta.name,
      group: meta.monster,
      groupKey: taskGroupKey(task.task),
      tier: meta.tier,
      type: meta.type,
      complete: task.complete,
    };
  }

  const prefix = parseTaskPrefix(task.task);
  const key = prefix ?? task.task;
  return {
    task: task.task,
    name: titleCaseSlug(task.task, '_'),
    group: titleCaseSlug(key, '_'),
    groupKey: key,
    complete: task.complete,
  };
}

export function summarizeCombatAchievements(tasks: CombatAchievementTaskView[], points: number): CombatAchievementSummary {
  return {
    points,
    complete: tasks.filter((t) => t.complete).length,
    total: tasks.length,
  };
}

function buildGroups(tasks: CombatAchievementTaskView[]): CombatAchievementGroup[] {
  const byKey = new Map<string, CombatAchievementGroup>();
  for (const task of tasks) {
    const existing = byKey.get(task.groupKey);
    if (existing) {
      existing.total++;
      if (task.complete) existing.complete++;
      continue;
    }
    byKey.set(task.groupKey, {
      key: task.groupKey,
      name: task.group,
      complete: task.complete ? 1 : 0,
      total: 1,
    });
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchCombatAchievements(username: string): Promise<CombatAchievementData> {
  const { stored, section: snapshot } = await requireSyncedSection(
    username, 'combatAchievements', 'No synced combat achievement data for this player.', (ca) => ca.tasks.length === 0);

  const tasks = [...snapshot.tasks]
    .map(withTaskView)
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name) || a.task.localeCompare(b.task));

  return {
    username: stored.username,
    syncedAt: stored.syncedAt,
    summary: summarizeCombatAchievements(tasks, snapshot.points),
    groups: buildGroups(tasks),
    tasks,
  };
}
