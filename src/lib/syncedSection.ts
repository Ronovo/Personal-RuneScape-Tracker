import { httpError } from './errors.js';
import { loadLeaguesSync } from './sync.js';
import type { LeaguesSyncPayload } from './sync.js';

export async function requireSyncedFile(username: string, emptyMessage: string): Promise<LeaguesSyncPayload> {
  const stored = await loadLeaguesSync(username);
  if (!stored) {
    throw httpError(emptyMessage, 404);
  }
  return stored;
}

export function requireSection<T>(
  value: T | undefined | null,
  emptyMessage: string,
): T {
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    throw httpError(emptyMessage, 404);
  }
  return value;
}
