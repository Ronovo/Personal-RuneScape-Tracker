// Combat achievement progress comes from the Leagues Tasks plugin sync - the
// plugin reads CA task varbits and total points when the user syncs.

import { lookupCombatAchievementMeta } from './combatachievementmeta.js';
import { titleCaseSlug } from './text.js';
import { requireSection, requireSyncedFile } from './syncedSection.js';
import type { CombatAchievementTask } from './sync.js';
import type {
  CombatAchievementData, CombatAchievementGroup, CombatAchievementSummary,
  CombatAchievementTaskView
} from '../shared/api.js';

export type {
  CombatAchievementData, CombatAchievementGroup, CombatAchievementSummary,
  CombatAchievementTaskView
};

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
  if (!/^(KILLCOUNT|MECHANICAL|PERFECTION|STAMINA|RESTRICTION|SPEED|ACCURACY|FORTITUDE|DURATION|RESTRAINT|PARTNER|SOLO|TRIO|DUO|QUAD|GROUP|RAID|CHALLENGE|TASK|COMBO|DEFENCE|OFFENCE|OFFENSE|FILTER)$/i.test(typeToken)) {
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
  const stored = await requireSyncedFile(username, 'No synced combat achievement data for this player.');
  const snapshot = requireSection(stored.combatAchievements, 'No synced combat achievement data for this player.');
  requireSection(snapshot.tasks, 'No synced combat achievement data for this player.');

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
