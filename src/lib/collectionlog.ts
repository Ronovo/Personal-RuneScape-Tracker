// Collection log contents aren't exposed by any official Jagex API - the
// OSRS hiscores only give a single aggregate "Collections Logged" count.
// This reads the snapshot the Ronovo's Sync Tool RuneLite plugin uploads
// (POST /api/sync/collectionlog or /api/sync/leagues), captured while the
// in-game interface is open.

import { requireSyncedSection } from './syncedSection.js';
import { loadJsonAsset } from './jsonStore.js';
import { wikiImageUrl } from './http.js';
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
  return wikiImageUrl(`${MANUAL_NAME_CONVERSION[itemName] || AUTO_NAME_CONVERSION[itemName] || itemName}.png`);
}

export async function fetchCollectionLog(username: string): Promise<CollectionLogData> {
  const { stored, section: snapshot } = await requireSyncedSection(
    username, 'collectionLog', 'No synced collection log found for this player.', (log) => log.groups.length === 0);

  const groups: CollectionGroup[] = snapshot.groups.map((group) => ({
    group: group.group,
    categories: group.categories.map((category): CollectionCategory => {
      const items = category.items.map((item) => ({
        name: item.name,
        count: item.count,
        icon: iconUrl(item.name)
      }));
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
