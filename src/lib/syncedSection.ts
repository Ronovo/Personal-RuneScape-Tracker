import { httpError } from './errors.js';
import { loadLeaguesSync } from './sync.js';
import type { LeaguesSyncPayload, SyncSection } from './sync.js';

/**
 * A player's synced file and one section of it, or a 404 with emptyMessage when the player never synced it,
 * it is an empty list, or isEmpty says the snapshot holds nothing.
 */
export async function requireSyncedSection<K extends SyncSection>(
  username: string,
  key: K,
  emptyMessage: string,
  isEmpty: (section: NonNullable<LeaguesSyncPayload[K]>) => boolean = () => false,
): Promise<{ stored: LeaguesSyncPayload; section: NonNullable<LeaguesSyncPayload[K]> }> {
  const stored = await loadLeaguesSync(username);
  const section = stored?.[key];
  if (section == null || (Array.isArray(section) && section.length === 0) || isEmpty(section)) {
    throw httpError(emptyMessage, 404);
  }
  return { stored: stored!, section };
}
