import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupTaskMeta, displayDifficulty, TASK_REGIONS, TASK_DIFFICULTIES, TASK_ACTIVITY_TYPES
} from './leaguetaskmeta.js';

test('lookupTaskMeta finds a real task id and returns null for an unknown one', () => {
  const meta = lookupTaskMeta('client-of-kourend');
  assert.ok(meta);
  assert.equal(meta!.name, 'Client of Kourend');
  assert.equal(meta!.region, 'General');
  assert.equal(meta!.difficulty, 'easy');
  assert.equal(meta!.activityType, 'Questing');

  // A taskId the plugin has since renamed/pruned (the pre-"obtain-" wording
  // of a since-deduplicated XP milestone task) - a real case seen in synced
  // data, not a hypothetical.
  assert.equal(lookupTaskMeta('25-million-attack-xp'), null);
  assert.equal(lookupTaskMeta('not-a-real-task-id'), null);
});

test('displayDifficulty capitalizes the raw lowercase tier', () => {
  assert.equal(displayDifficulty('beginner'), 'Beginner');
  assert.equal(displayDifficulty('elite'), 'Elite');
});

test('canonical filter option lists cover every real value, in the right order', () => {
  // Regions/activity types: alphabetical, matching the plugin's own dropdowns.
  assert.deepEqual([...TASK_REGIONS].sort(), TASK_REGIONS);
  assert.ok(TASK_REGIONS.includes('General'));
  assert.ok(TASK_REGIONS.includes('Wilderness'));

  assert.deepEqual([...TASK_ACTIVITY_TYPES].sort(), TASK_ACTIVITY_TYPES);
  assert.ok(TASK_ACTIVITY_TYPES.includes('Questing'));
  assert.ok(TASK_ACTIVITY_TYPES.includes('Skilling'));
  assert.ok(TASK_ACTIVITY_TYPES.includes('Combat/Magic'));
  assert.ok(TASK_ACTIVITY_TYPES.includes('Combat Achievements'));
  assert.ok(TASK_ACTIVITY_TYPES.includes('Boss'));
  assert.ok(TASK_ACTIVITY_TYPES.includes('Minigame'));
  assert.ok(!TASK_ACTIVITY_TYPES.includes('Boss/Minigame'));
  assert.ok(!TASK_ACTIVITY_TYPES.includes('Minigame/Boss'));

  const wintertodt = lookupTaskMeta('25-wintertodt-kills');
  assert.ok(wintertodt);
  assert.equal(wintertodt!.region, 'Kourend');
  assert.equal(wintertodt!.activityType, 'Minigame');

  const caTask = lookupTaskMeta('1-easy-combat-achievement');
  assert.ok(caTask);
  assert.equal(caTask!.activityType, 'Combat Achievements');

  // Difficulty: real progression (beginner -> master), not alphabetical.
  assert.deepEqual(TASK_DIFFICULTIES, ['Beginner', 'Easy', 'Medium', 'Hard', 'Elite', 'Master']);
});
