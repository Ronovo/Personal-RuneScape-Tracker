import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMeta, summarize } from './quests.js';
import type { QuestProgress } from './sync.js';
import type { QuestWithMeta } from './quests.js';

function progress(name: string, state: QuestProgress['state']): QuestProgress {
  return { id: 1, name, state };
}

test('withMeta decorates a known quest with its real wiki kind/members', () => {
  const q = withMeta(progress("Cook's Assistant", 'FINISHED'));
  assert.equal(q.kind, 'quest');
  assert.equal(q.members, false);

  const mini = withMeta(progress("Alfred Grimhand's Barcrawl", 'FINISHED'));
  assert.equal(mini.kind, 'miniquest');
  assert.equal(mini.members, true);
});

// A quest too new for the wiki scrape defaults to a members quest, per the
// comment on withMeta - that's what keeps it visible under default filters.
test('withMeta defaults an unrecognized quest to a visible members quest', () => {
  const q = withMeta(progress('Some Quest Not Yet Scraped', 'NOT_STARTED'));
  assert.equal(q.kind, 'quest');
  assert.equal(q.members, true);
});

test('summarize counts by state, kind, and membership independently', () => {
  const quests: QuestWithMeta[] = [
    { id: 1, name: 'A', state: 'FINISHED', kind: 'quest', members: true },
    { id: 2, name: 'B', state: 'FINISHED', kind: 'miniquest', members: false },
    { id: 3, name: 'C', state: 'IN_PROGRESS', kind: 'quest', members: true },
    { id: 4, name: 'D', state: 'NOT_STARTED', kind: 'miniquest', members: true }
  ];

  assert.deepEqual(summarize(quests), {
    complete: 2,
    inProgress: 1,
    notStarted: 1,
    miniquests: 2,
    freeToPlay: 1
  });
});
