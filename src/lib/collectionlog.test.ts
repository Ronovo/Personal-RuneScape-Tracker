import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Same SYNC_DATA_DIR-before-first-import requirement as sync.test.ts -
// collectionlog.js imports sync.js, which reads SYNC_DIR from the env at
// module load time.
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-collectionlog-test-'));
process.env.SYNC_DATA_DIR = tmpDir;

const { saveLeaguesSync } = await import('./sync.js');
const { fetchCollectionLog } = await import('./collectionlog.js');

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('fetchCollectionLog throws a 404 when nothing has been synced', async () => {
  await assert.rejects(() => fetchCollectionLog('no-such-player'), (err) => {
    assert.match((err as Error).message, /synced/i);
    assert.equal((err as { statusCode?: number }).statusCode, 404);
    return true;
  });
});

test('fetchCollectionLog computes per-category progress and category completion', async () => {
  await saveLeaguesSync({
    username: 'clog-user',
    syncedAt: '2026-01-01T00:00:00Z',
    collectionLog: {
      itemsObtained: 42,
      itemsAvailable: 100,
      groups: [
        {
          group: 'Bosses',
          categories: [
            {
              key: 'abyssal-sire',
              name: 'Abyssal Sire',
              items: [
                { id: 4151, name: 'Abyssal whip', count: 1 },
                { id: 13273, name: 'Unsired', count: 0 }
              ]
            },
            {
              key: 'zulrah',
              name: 'Zulrah',
              items: [{ id: 12921, name: "Tanzanite fang", count: 1 }]
            }
          ]
        }
      ]
    }
  });

  const data = await fetchCollectionLog('clog-user');

  // Top-level totals pass through from the stored snapshot verbatim - they
  // come from the plugin's own distinct-item-id count, not a recompute.
  assert.equal(data.itemsObtained, 42);
  assert.equal(data.itemsAvailable, 100);

  const [sire, zulrah] = data.groups[0]!.categories;
  assert.equal(sire!.obtained, 1);
  assert.equal(sire!.total, 2);
  assert.equal(zulrah!.obtained, 1);
  assert.equal(zulrah!.total, 1);

  // Only the fully-cleared category counts toward categoriesFinished.
  assert.equal(data.categoriesFinished, 1);
  assert.equal(data.categoriesAvailable, 2);
});

test('fetchCollectionLog resolves icon URLs through the name-conversion table, falling back to the raw name', async () => {
  await saveLeaguesSync({
    username: 'icon-user',
    syncedAt: '2026-01-01T00:00:00Z',
    collectionLog: {
      itemsObtained: 2,
      itemsAvailable: 2,
      groups: [
        {
          group: 'Bosses',
          categories: [
            {
              key: 'misc',
              name: 'Misc',
              items: [
                // "Bolt rack" has an explicit auto-conversion entry (-> "Bolt rack 1").
                { id: 4740, name: 'Bolt rack', count: 1 },
                // No override for this name - falls through to the raw name.
                { id: 4151, name: 'Abyssal whip', count: 1 }
              ]
            }
          ]
        }
      ]
    }
  });

  const data = await fetchCollectionLog('icon-user');
  const items = data.groups[0]!.categories[0]!.items;

  assert.equal(
    items.find((i) => i.name === 'Bolt rack')!.icon,
    'https://oldschool.runescape.wiki/images/Bolt_rack_1.png'
  );
  assert.equal(
    items.find((i) => i.name === 'Abyssal whip')!.icon,
    'https://oldschool.runescape.wiki/images/Abyssal_whip.png'
  );
});
