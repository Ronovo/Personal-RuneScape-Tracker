import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireSection } from './syncedSection.js';

// "Synced, but with nothing in it" and "never synced" look the same to a
// player, so both have to reach the sync-help panel rather than an empty list.
test('requireSection treats null, undefined and an empty array as not synced', () => {
  for (const value of [null, undefined, []]) {
    assert.throws(
      () => requireSection(value, 'No synced quest data for this player.'),
      (err: unknown) => {
        assert.equal((err as { statusCode?: number }).statusCode, 404);
        assert.match((err as Error).message, /No synced quest data/);
        return true;
      },
    );
  }
});

test('requireSection passes through anything with content', () => {
  assert.deepEqual(requireSection([1, 2], 'x'), [1, 2]);
  assert.deepEqual(requireSection({ points: 0, tasks: [] }, 'x'), { points: 0, tasks: [] });
  // 0 and '' are values, not absences - only null/undefined/[] are "unsynced".
  assert.equal(requireSection(0, 'x'), 0);
});
