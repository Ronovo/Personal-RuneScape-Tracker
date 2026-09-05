// The "Playing as" identity and the per-identity state hanging off it.
//
// Not authentication - that is auth.ts. This is just a name kept in
// localStorage so the Flip watchlist and bankroll have something to be keyed
// by and username boxes can pre-fill themselves. It used to live in session.ts
// alongside the whole page header and auth panel; the header now listens for
// the change event below rather than being called into from here, so this
// module has no idea a header exists.

import { safeJsonParse, fetchJson, apiAuthHeaders, storageGet, storageRemove, storageSet } from './format.js';

const CURRENT_USER_KEY = 'osrs_current_user';
const KNOWN_USERS_KEY = 'osrs_known_users';
const KNOWN_USERS_MAX = 15;
const GUEST_BUCKET = '_guest_';

/** Fired whenever the identity changes; every page re-reads its per-user state. */
export const SESSION_CHANGE_EVENT = 'osrs-session-change';

export function emitSessionChange(): void {
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

export function clearUsername(): void {
  storageRemove(localStorage, CURRENT_USER_KEY);
  emitSessionChange();
}

function readJson<T>(key: string, fallback: T): T {
  return safeJsonParse(storageGet(localStorage, key), fallback);
}

export function getUsername(): string | null {
  return storageGet(localStorage, CURRENT_USER_KEY) || null;
}

// Pre-fills a username box from the current session, if one is set.
export function prefillUsername(input: HTMLInputElement): void {
  const username = getUsername();
  if (username) input.value = username;
}

export function getKnownUsers(): string[] {
  return readJson<string[]>(KNOWN_USERS_KEY, []);
}

export function setUsername(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  storageSet(localStorage, CURRENT_USER_KEY, trimmed);

  const known = [trimmed, ...getKnownUsers().filter((n) => n.toLowerCase() !== trimmed.toLowerCase())].slice(0, KNOWN_USERS_MAX);
  storageSet(localStorage, KNOWN_USERS_KEY, JSON.stringify(known));

  emitSessionChange();
}

// Scopes localStorage keys per "Playing as" identity, falling back to the guest bucket.
function userKey(prefix: string): string {
  return `${prefix}::${getUsername() || GUEST_BUCKET}`;
}

// Starred Flip Helper items. Stored server-side per character (keyed by the
// "Playing as" name) so the same name sees the same watchlist on any device
// or browser - not just the one that starred it. A guest (no name set) has
// no server identity to key by, so falls back to a browser-local list.
// watchlistCache is the synchronous read path every render in flip.ts uses;
// loadWatchlist() is the async call that fills it, at startup and whenever
// the "Playing as" identity changes.
let watchlistCache: number[] = [];

function guestWatchlist(): number[] {
  return readJson<number[]>(userKey('osrs_flip_watchlist'), []);
}

export function getWatchlist(): number[] {
  return watchlistCache;
}

export async function loadWatchlist(): Promise<number[]> {
  const username = getUsername();
  if (!username) {
    watchlistCache = guestWatchlist();
    return watchlistCache;
  }

  try {
    const { data } = await fetchJson<{ itemIds?: number[] }>(`/api/watchlist/${encodeURIComponent(username)}`);
    watchlistCache = Array.isArray(data.itemIds) ? data.itemIds : [];
  } catch {
    // Server unreachable - keep whatever's cached rather than blanking the list.
  }
  return watchlistCache;
}

export function toggleWatchlist(id: number): number[] {
  const numId = Number(id);
  watchlistCache = watchlistCache.includes(numId)
    ? watchlistCache.filter((x) => x !== numId)
    : [numId, ...watchlistCache];

  const username = getUsername();
  if (!username) {
    storageSet(localStorage, userKey('osrs_flip_watchlist'), JSON.stringify(watchlistCache));
    return watchlistCache;
  }

  // Fire-and-forget: the cache above already reflects the change, so a
  // dropped request just means the next loadWatchlist() call re-syncs it.
  fetch(`/api/watchlist/${encodeURIComponent(username)}`, {
    method: 'PUT',
    headers: apiAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ itemIds: watchlistCache })
  }).catch(() => {});

  return watchlistCache;
}

// Bankroll for the Flip Helper "Fits My Bankroll" preset, same per-user bucket.
export function getBankroll(): number {
  const n = Number(storageGet(localStorage, userKey('osrs_bankroll')));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setBankroll(n: number): number {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return getBankroll();
  storageSet(localStorage, userKey('osrs_bankroll'), String(value));
  return value;
}
