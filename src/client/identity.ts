// The "Playing as" identity and the per-identity state hanging off it.
//
// Not authentication - that is auth.ts. This is just a name kept in
// localStorage so the Flip watchlist and bankroll have something to be keyed
// by and username boxes can pre-fill themselves.

import { safeJsonParse, fetchJson, apiAuthHeaders, storageGet, storageRemove, storageSet, API_TOKEN_KEY } from './format.js';
import { loadAuthStatus } from './auth.js';

const CURRENT_USER_KEY = 'osrs_current_user';
const KNOWN_USERS_KEY = 'osrs_known_users';
const KNOWN_USERS_MAX = 15;
const GUEST_BUCKET = '_guest_';
const BANKROLL_KEY = 'osrs_bankroll';
const BANKROLL_SAVED_KEY = 'osrs_bankroll_saved_at';
const BANKROLL_PREFIX = `${BANKROLL_KEY}::`;
const BANKROLL_SAVED_PREFIX = `${BANKROLL_SAVED_KEY}::`;

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
    const { ok, data } = await fetchJson<{ itemIds?: number[] }>(`/api/watchlist/${encodeURIComponent(username)}`);
    if (ok) watchlistCache = Array.isArray(data.itemIds) ? data.itemIds : [];
  } catch {
    // Server unreachable - keep whatever's cached rather than blanking the list.
  }
  return watchlistCache;
}

/** `onFail` hears why the server didn't keep the change; the list here has it either way. */
export function toggleWatchlist(id: number, onFail: (message: string) => void = () => {}): number[] {
  const numId = Number(id);
  watchlistCache = watchlistCache.includes(numId)
    ? watchlistCache.filter((x) => x !== numId)
    : [numId, ...watchlistCache];

  const username = getUsername();
  if (!username) {
    storageSet(localStorage, userKey('osrs_flip_watchlist'), JSON.stringify(watchlistCache));
    return watchlistCache;
  }

  fetch(`/api/watchlist/${encodeURIComponent(username)}`, {
    method: 'PUT',
    headers: apiAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ itemIds: watchlistCache })
  }).then((res) => {
    if (res.status === 401 || res.status === 403) onFail('Your watchlist was not saved. Sign in again to keep it.');
    else if (!res.ok) onFail('Your watchlist was not saved.');
  }).catch(() => onFail('Your watchlist was not saved: the server could not be reached.'));

  return watchlistCache;
}

// Bankroll for the Flip Helper "Fits My Bankroll" preset, same per-user bucket.
export function getBankroll(): number {
  const n = Number(storageGet(localStorage, userKey(BANKROLL_KEY)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setBankroll(n: number): number {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return getBankroll();
  // Only a real change is stamped, so opening Flip can't make a stale bankroll look newer than another device's.
  if (value === getBankroll()) return value;
  storageSet(localStorage, userKey(BANKROLL_KEY), String(value));
  storageSet(localStorage, userKey(BANKROLL_SAVED_KEY), String(Date.now()));
  void syncBankrolls();
  return value;
}

type SavedBankroll = { value: number; savedAt: number };

function localBankrolls(): Record<string, SavedBankroll> {
  const bankrolls: Record<string, SavedBankroll> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(BANKROLL_PREFIX)) continue;
      const bucket = key.slice(BANKROLL_PREFIX.length);
      const value = Number(storageGet(localStorage, key));
      if (!Number.isFinite(value) || value < 0) continue;
      bankrolls[bucket] = { value, savedAt: Number(storageGet(localStorage, BANKROLL_SAVED_PREFIX + bucket)) || 0 };
    }
  } catch {
    // Storage blocked - nothing local to send.
  }
  return bankrolls;
}

/**
 * Merges this browser's bankrolls with the signed-in account's, newer value
 * per player winning, so a bankroll set on one device shows up on the others.
 * Resolves true when a local value changed. Without an account token the
 * server answers 401 and nothing changes.
 */
export async function syncBankrolls(): Promise<boolean> {
  // Only an account token has bankrolls; a LAN host's browser holds the wildcard token instead.
  if (!storageGet(localStorage, API_TOKEN_KEY) || (await loadAuthStatus()).mode !== 'public') return false;
  let changed = false;
  try {
    const local = localBankrolls();
    const { ok, data } = await fetchJson<{ bankrolls?: Record<string, SavedBankroll> }>('/api/auth/bankrolls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankrolls: local }),
    });
    if (!ok || !data.bankrolls) return false;
    for (const [bucket, entry] of Object.entries(data.bankrolls)) {
      if (local[bucket]?.value === entry.value) continue;
      storageSet(localStorage, BANKROLL_PREFIX + bucket, String(entry.value));
      storageSet(localStorage, BANKROLL_SAVED_PREFIX + bucket, String(entry.savedAt));
      changed = true;
    }
  } catch {
    // Server unreachable - the local values stand until the next sync.
  }
  return changed;
}
