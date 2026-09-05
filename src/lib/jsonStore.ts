// Shared "one JSON file per key" storage shape used by both sync.ts (synced
// player data) and watchlist.ts (Flip Helper watchlists), plus a loader for
// the static JSON assets (leaguetaskmeta.ts, questmeta.ts, collectionlog.ts)
// that copy-assets.mjs places next to the compiled output.

import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function storagePathFor(dir: string, key: string): string {
  return path.join(dir, `${key}.json`);
}

// Read once at startup - callers pass their own import.meta.url so the
// asset resolves relative to the calling module regardless of who imports it.
export function loadJsonAsset<T>(importMetaUrl: string, filename: string): T {
  const dir = path.dirname(fileURLToPath(importMetaUrl));
  return JSON.parse(readFileSync(path.join(dir, filename), 'utf8')) as T;
}

// Reads and JSON.parses a file, returning fallback if it doesn't exist yet -
// callers still see any other read/parse error (a corrupt file shouldn't
// silently look like "never written").
export async function readJsonOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }
}
