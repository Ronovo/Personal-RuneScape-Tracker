// Leagues task completions come from the same plugin sync as quests - this
// re-serves what's already on disk, decorated with the region/difficulty/
// activity type classification the plugin can't send per-task (see
// leaguetaskmeta.ts) plus the canonical filter option lists the Tasks page
// filter UI uses.

import { lookupTaskMeta, displayDifficulty, TASK_REGIONS, TASK_DIFFICULTIES, TASK_ACTIVITY_TYPES } from './leaguetaskmeta.js';
import { requireSection, requireSyncedFile } from './syncedSection.js';
import { titleCaseSlug } from './text.js';
import type { CompletedTaskRecord } from './sync.js';
import type { CompletedTaskWithMeta, LeaguesTasksData, TaskFilterOptions } from '../shared/api.js';

export type { CompletedTaskWithMeta, LeaguesTasksData, TaskFilterOptions };

const UNKNOWN = 'Unknown';

/** Exported for tests: the metadata-miss path real synced data never hits. */
export function withMeta(task: CompletedTaskRecord): CompletedTaskWithMeta {
  const meta = lookupTaskMeta(task.taskId);
  return {
    ...task,
    // Keeps the row readable instead of showing a raw slug when the plugin
    // has renamed or pruned a task since the last metadata import.
    name: meta?.name ?? titleCaseSlug(task.taskId, '-'),
    region: meta?.region ?? UNKNOWN,
    difficulty: meta ? displayDifficulty(meta.difficulty) : UNKNOWN,
    activityType: meta?.activityType ?? UNKNOWN
  };
}

export async function fetchLeaguesTasks(username: string): Promise<LeaguesTasksData> {
  const stored = await requireSyncedFile(username, 'No synced task data for this player.');
  const completedTasks = requireSection(stored.completedTasks, 'No synced task data for this player.');

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
