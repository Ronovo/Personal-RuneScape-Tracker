// Leagues task completions are made in the Leagues Tasks plugin and sent by
// the same Ronovo's Sync Tool sync as quests - this re-serves what's already
// on disk, decorated with the region/difficulty/activity type classification
// the plugin can't send per-task (see leaguetaskmeta.ts) plus the canonical
// filter option lists the Tasks page filter UI uses.

import { lookupTaskMeta, TASK_REGIONS, TASK_DIFFICULTIES, TASK_ACTIVITY_TYPES } from './leaguetaskmeta.js';
import { requireSyncedSection } from './syncedSection.js';
import { capitalize, titleCaseSlug } from './text.js';
import type { CompletedTaskRecord } from './sync.js';
import { UNKNOWN_LABEL as UNKNOWN } from '../shared/api.js';
import type { CompletedTaskWithMeta, LeaguesTasksData } from '../shared/api.js';

export function withMeta(task: CompletedTaskRecord): CompletedTaskWithMeta {
  const meta = lookupTaskMeta(task.taskId);
  return {
    ...task,
    // Keeps the row readable instead of showing a raw slug when the plugin
    // has renamed or pruned a task since the last metadata import.
    name: meta?.name ?? titleCaseSlug(task.taskId, '-'),
    region: meta?.region ?? UNKNOWN,
    difficulty: meta ? capitalize(meta.difficulty) : UNKNOWN,
    activityType: meta?.activityType ?? UNKNOWN
  };
}

export async function fetchLeaguesTasks(username: string): Promise<LeaguesTasksData> {
  const { stored, section: completedTasks } = await requireSyncedSection(
    username, 'completedTasks', 'No synced task data for this player.');

  return {
    username: stored.username,
    syncedAt: stored.syncedAt,
    completedTasks: completedTasks.map(withMeta),
    filters: {
      regions: [...TASK_REGIONS],
      difficulties: [...TASK_DIFFICULTIES],
      activityTypes: [...TASK_ACTIVITY_TYPES]
    }
  };
}
