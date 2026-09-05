// Flip Helper watchlist, stored per player rather than per browser - one
// JSON file per username, same layout as sync.ts's leagues snapshots, so the
// same character sees the same starred items on any device.

import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteFile } from './atomicWrite.js';
import { httpError } from './errors.js';
import { storageKey } from './sync.js';
import { storagePathFor, readJsonOrDefault } from './jsonStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATCHLIST_DIR = process.env.WATCHLIST_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'watchlist');
const MAX_WATCHLIST_ITEMS = 200;

function storagePath(username: string): string {
  return storagePathFor(WATCHLIST_DIR, storageKey(username));
}

// De-dupes and drops anything that isn't a whole item id - the request body
// is untrusted JSON from the browser.
function parseItemIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw httpError('Invalid watchlist', 400);
  }
  const ids = value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v));
  const unique = [...new Set(ids)];
  if (unique.length > MAX_WATCHLIST_ITEMS) {
    throw httpError(`Watchlist cannot exceed ${MAX_WATCHLIST_ITEMS} items`, 400);
  }
  return unique;
}

export async function loadWatchlist(username: string): Promise<number[]> {
  const data = await readJsonOrDefault<{ itemIds?: unknown } | null>(storagePath(username), null);
  return data === null ? [] : parseItemIds(data.itemIds);
}

export async function saveWatchlist(username: string, itemIds: unknown): Promise<number[]> {
  const ids = parseItemIds(itemIds);
  await atomicWriteFile(storagePath(username), JSON.stringify({ itemIds: ids }, null, 2));
  return ids;
}
