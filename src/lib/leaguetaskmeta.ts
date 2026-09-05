// Decodes a completed task's id slug (all the plugin sync gives us) into the
// Leagues Task Randomizer plugin's own region/difficulty/activity type
// classification for it. The data is imported offline by
// scripts/import-leagues-task-metadata.mjs - see that file for where it
// comes from and how to refresh it.

import { loadJsonAsset } from './jsonStore.js';
import { capitalize } from './text.js';

export interface TaskMeta {
  id: string;
  name: string;
  region: string;
  difficulty: string;
  activityType: string;
}

interface TaskMetadataFile {
  source: string;
  scrapedAt: string;
  tasks: TaskMeta[];
}

const metadata: TaskMetadataFile = loadJsonAsset(import.meta.url, 'leagues-task-metadata.json');

const byId = new Map(metadata.tasks.map((t) => [t.id, t]));

// Real difficulty progression, not alphabetical - mirrors the plugin's own
// TaskRepository.DIFFICULTY_ORDER. Keep in sync with that if the plugin ever
// adds a tier.
const DIFFICULTY_ORDER = ['beginner', 'easy', 'medium', 'hard', 'elite', 'master'];

/** Null when a task's id isn't in the imported list - usually the plugin
 * renamed/pruned it in a later scrape than the one this app imported. */
export function lookupTaskMeta(taskId: string): TaskMeta | null {
  return byId.get(taskId) ?? null;
}

// The full canonical value sets for each filter dimension, in the same
// order/casing the plugin's own filter dropdowns use - regions and activity
// types alphabetically, difficulty by real progression.
export const TASK_REGIONS: string[] = [...new Set(metadata.tasks.map((t) => t.region))].sort();
export const TASK_ACTIVITY_TYPES: string[] = [...new Set(metadata.tasks.map((t) => t.activityType))].sort();
export const TASK_DIFFICULTIES: string[] = DIFFICULTY_ORDER
  .filter((tier) => metadata.tasks.some((t) => t.difficulty === tier))
  .map(capitalize);

export function displayDifficulty(difficulty: string): string {
  return capitalize(difficulty);
}
