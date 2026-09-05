import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMeta } from './leaguetasks.js';

const record = { taskId: '250-total-level', completedAt: '2026-08-28T20:48:15Z', source: 'AUTO' as const };

test('withMeta joins the imported metadata onto a synced task', () => {
  const row = withMeta(record);
  assert.equal(row.name, '250 Total Level');
  assert.equal(row.difficulty, 'Easy');
  assert.ok(row.region && row.region !== 'Unknown');
  // The sync record's own fields survive the join.
  assert.equal(row.taskId, record.taskId);
  assert.equal(row.source, 'AUTO');
});

// The path real synced data never exercises, because every id in it resolves.
// A task the plugin renamed or pruned since the last import must still read as
// a task rather than as a raw slug.
test('an unrecognised task id degrades to a readable label, not a raw slug', () => {
  const row = withMeta({ taskId: 'some-brand-new-task', completedAt: '2026-08-28T20:48:15Z' });
  assert.equal(row.name, 'Some Brand New Task');
  assert.equal(row.region, 'Unknown');
  assert.equal(row.difficulty, 'Unknown');
  assert.equal(row.activityType, 'Unknown');
});
