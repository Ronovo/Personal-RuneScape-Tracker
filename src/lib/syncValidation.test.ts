import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// SYNC_DIR is read when sync.js loads, so it is set before the dynamic import.
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-sync-validation-test-'));
process.env.SYNC_DATA_DIR = tmpDir;

const { assertAllowedUsername, parsePayload, loadLeaguesSync, saveLeaguesSync } = await import('./sync.js');

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const item = { id: 1, name: 'Bronze dagger', count: 1 };
const category = { key: 'dagger', name: 'Daggers', items: [item] };
const group = { group: 'Other', categories: [category] };

const rejected: [string, unknown, string][] = [
  ['a body that is not an object', null, 'Invalid JSON body'],
  ['a blank username', { username: '  ' }, 'Missing or invalid username'],
  ['completed tasks that are not objects', { username: 'a', completedTasks: [null] }, 'Invalid completedTasks entry'],
  ['an unknown task source', { username: 'a', completedTasks: [{ taskId: 't', completedAt: 'x', source: 'GUESS' }] },
    'Invalid completedTasks entry'],
  ['quests that are not a list', { username: 'a', quests: {} }, 'Invalid quests'],
  ['a quest that is not an object', { username: 'a', quests: [7] }, 'Invalid quests entry'],
  ['a quest without a numeric id', { username: 'a', quests: [{ id: '1', name: 'Q', state: 'FINISHED' }] },
    'Invalid quest id'],
  ['a quest without a name', { username: 'a', quests: [{ id: 1, name: ' ', state: 'FINISHED' }] }, 'Invalid quest name'],
  ['a quest in an unknown state', { username: 'a', quests: [{ id: 1, name: 'Q', state: 'DONE' }] }, 'Invalid quest state'],
  ['a collection log that is not an object', { username: 'a', collectionLog: 'all of it' }, 'Invalid collectionLog'],
  ['collection log groups that are not a list', { username: 'a', collectionLog: { groups: {} } },
    'Invalid collectionLog groups'],
  ['a group that is not an object', { username: 'a', collectionLog: { groups: [null] } }, 'Invalid collectionLog group'],
  ['a group without a name', { username: 'a', collectionLog: { groups: [{ ...group, group: '' }] } },
    'Invalid collectionLog group name'],
  ['categories that are not a list', { username: 'a', collectionLog: { groups: [{ ...group, categories: 'x' }] } },
    'Invalid collectionLog categories'],
  ['a category that is not an object', { username: 'a', collectionLog: { groups: [{ ...group, categories: [0] }] } },
    'Invalid collectionLog category'],
  ['a category without a key', { username: 'a', collectionLog: { groups: [{ ...group, categories: [{ ...category,
    key: '' }] }] } }, 'Invalid collectionLog category name'],
  ['a category without a name', { username: 'a', collectionLog: { groups: [{ ...group, categories: [{ ...category,
    name: ' ' }] }] } }, 'Invalid collectionLog category name'],
  ['items that are not a list', { username: 'a', collectionLog: { groups: [{ ...group, categories: [{ ...category,
    items: 'x' }] }] } }, 'Invalid collectionLog items'],
  ...([
    [null, 'Invalid collectionLog item'],
    [{ ...item, id: 'one' }, 'Invalid collectionLog item id'],
    [{ ...item, name: '' }, 'Invalid collectionLog item name'],
    [{ ...item, count: 'many' }, 'Invalid collectionLog item count'],
  ] as const).map(([bad, message]): [string, unknown, string] => [
    `an item like ${JSON.stringify(bad)}`,
    { username: 'a', collectionLog: { groups: [{ ...group, categories: [{ ...category, items: [bad] }] }] } },
    message,
  ]),
  ['a diary entry that is not an object', { username: 'a', achievementDiary: ['ARDOUGNE'] },
    'Invalid achievementDiary entry'],
  ['a diary without an area', { username: 'a', achievementDiary: [{ area: '', tier: 'EASY', complete: true }] },
    'Invalid achievementDiary area'],
  ['a diary without a complete flag', { username: 'a', achievementDiary: [{ area: 'Ardougne', tier: 'EASY',
    complete: 'yes' }] }, 'Invalid achievementDiary complete flag'],
  ['combat achievements that are not an object', { username: 'a', combatAchievements: 'lots' },
    'Invalid combatAchievements'],
  ['combat achievement tasks that are not a list', { username: 'a', combatAchievements: { points: 1, tasks: {} } },
    'Invalid combatAchievements tasks'],
  ['a combat achievement task that is not an object', { username: 'a', combatAchievements: { points: 1, tasks: [1] } },
    'Invalid combatAchievements task entry'],
  ['a combat achievement task without an id', { username: 'a', combatAchievements: { points: 1,
    tasks: [{ task: '', complete: true }] } }, 'Invalid combatAchievements task id'],
  ['a combat achievement task without a complete flag', { username: 'a', combatAchievements: { points: 1,
    tasks: [{ task: 'Noxious Foe', complete: 1 }] } }, 'Invalid combatAchievements task complete flag'],
];

for (const [what, body, message] of rejected) {
  test(`a sync with ${what} is refused`, () => {
    assert.throws(() => parsePayload(body), { message, statusCode: 400 });
  });
}

test('a collection log without totals counts its own items', () => {
  const log = { groups: [{ ...group, categories: [{ ...category, items: [item, { ...item, id: 2, count: 0 }] }] }] };
  const parsed = parsePayload({ username: 'a', collectionLog: log }).collectionLog;
  assert.equal(parsed?.itemsObtained, 1);
  assert.equal(parsed?.itemsAvailable, 2);
});

test('a sync time that is not text is left blank', () => {
  assert.equal(parsePayload({ username: 'a', syncedAt: 12345 }).syncedAt, '');
});

test('a stored file with a sync time that is not text loads with a blank time', async () => {
  await saveLeaguesSync({ username: 'odd-time', syncedAt: 42 as unknown as string });
  assert.equal((await loadLeaguesSync('odd-time'))?.syncedAt, '');
});

test('an account token may only sync the names it has claimed', () => {
  const req = { auth: { scope: 'user' as const, rsns: ['zezima'] } } as Parameters<typeof assertAllowedUsername>[0];
  assert.doesNotThrow(() => assertAllowedUsername(req, 'Zezima'));
  assert.throws(() => assertAllowedUsername(req, 'Lynx Titan'),
    { message: 'Forbidden - claim this RSN on your account first', statusCode: 403 });
  const noClaims = { auth: { scope: 'user' as const } } as Parameters<typeof assertAllowedUsername>[0];
  assert.throws(() => assertAllowedUsername(noClaims, 'Zezima'), { statusCode: 403 });
});
