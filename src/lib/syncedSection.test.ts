import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-synced-section-test-'));
process.env.SYNC_DATA_DIR = tmpDir;

const { saveLeaguesSync } = await import('./sync.js');
const { requireSyncedSection } = await import('./syncedSection.js');

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// "Synced, but with nothing in it" and "never synced" look the same to a
// player, so both have to reach the sync-help panel rather than an empty list.
test('requireSyncedSection treats a missing file, a missing section and an empty list as not synced', async () => {
  await assert.rejects(() => requireSyncedSection('nobody', 'quests', 'No quests'), /No quests/);
  await saveLeaguesSync({ username: 'empty', syncedAt: '', quests: [] });
  await assert.rejects(() => requireSyncedSection('empty', 'quests', 'No quests'), /No quests/);
  await assert.rejects(() => requireSyncedSection('empty', 'achievementDiary', 'No diaries'), /No diaries/);
});

test('requireSyncedSection asks isEmpty about snapshots', async () => {
  await saveLeaguesSync({ username: 'nolog', syncedAt: '', collectionLog: { itemsObtained: 0, itemsAvailable: 0, groups: [] } });
  await assert.rejects(
    () => requireSyncedSection('nolog', 'collectionLog', 'No log', (log) => log.groups.length === 0), /No log/);
});

test('requireSyncedSection hands back the file and the section', async () => {
  await saveLeaguesSync({ username: 'quester', syncedAt: 'now', quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }] });
  const { stored, section } = await requireSyncedSection('quester', 'quests', 'No quests');
  assert.equal(stored.syncedAt, 'now');
  assert.equal(section.length, 1);
});
