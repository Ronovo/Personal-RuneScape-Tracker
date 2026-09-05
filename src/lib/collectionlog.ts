// Collection log contents aren't exposed by any official Jagex API - the
// OSRS hiscores only give a single aggregate "Collections Logged" count.
// This reads the snapshot the Leagues Tasks RuneLite plugin uploads to
// /api/sync/leagues instead, captured while the in-game interface is open.
// The game only reports which slots are filled, not duplicate quantities,
// so every item here has a count of 1 (obtained) or 0.

import { httpError } from './errors.js';
import { requireSyncedFile } from './syncedSection.js';
import { loadJsonAsset } from './jsonStore.js';
import type {
  CollectionCategory, CollectionGroup, CollectionLogData
} from '../shared/api.js';

interface ImageNameConversion {
  auto: Record<string, string>;
  manual: Record<string, string>;
}

// Overrides for items whose real wiki filename can't be derived from the
// item name by a simple rule. "auto" was resolved automatically (custom
// casing, or stack/charge items with no bare filename); "manual" is filled
// in by hand as broken icons are found, so it is checked first - a hand-added
// entry exists precisely to correct a wrong automatic one. Either map may
// still be missing an item, which falls through to the raw name like normal.
const { auto: AUTO_NAME_CONVERSION, manual: MANUAL_NAME_CONVERSION } = loadJsonAsset<{
  image_name_conversion: ImageNameConversion;
}>(import.meta.url, 'image_name_conversion.json').image_name_conversion;

function iconUrl(itemName: string): string {
  const resolvedName = MANUAL_NAME_CONVERSION[itemName] || AUTO_NAME_CONVERSION[itemName] || itemName;
  return `https://oldschool.runescape.wiki/images/${encodeURIComponent(resolvedName.replace(/ /g, '_'))}.png`;
}

export async function fetchCollectionLog(username: string): Promise<CollectionLogData> {
  const stored = await requireSyncedFile(username, 'No synced collection log found for this player.');
  const snapshot = stored.collectionLog;
  if (!snapshot) {
    throw httpError('No synced collection log found for this player.', 404);
  }

  const groups: CollectionGroup[] = snapshot.groups.map((group) => ({
    group: group.group,
    categories: group.categories.map((category): CollectionCategory => {
      const items = category.items.map((item) => ({
        name: item.name,
        count: item.count,
        icon: iconUrl(item.name)
      }));
      // Category progress counts obtained slots; the plugin can't report
      // duplicate quantities, so this is also the sum of the counts.
      return {
        key: category.key,
        name: category.name,
        obtained: items.filter((i) => i.count > 0).length,
        total: items.length,
        items
      };
    })
  }));

  const categories = groups.flatMap((g) => g.categories);
  return {
    username: stored.username,
    syncedAt: stored.syncedAt,
    // Totals come from the plugin, which counts distinct item ids - a pet
    // listed on several pages is one item, matching the in-game total.
    itemsObtained: snapshot.itemsObtained,
    itemsAvailable: snapshot.itemsAvailable,
    categoriesFinished: categories.filter((c) => c.total > 0 && c.obtained >= c.total).length,
    categoriesAvailable: categories.length,
    groups
  };
}
