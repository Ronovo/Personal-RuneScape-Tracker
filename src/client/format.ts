// Shared null-safe formatters, imported by every page script so character,
// GE, item, and Flip Helper all render numbers the same way.

// GE tax math lives in src/shared so client and server can't drift.
export { geTax } from '../shared/getax.js';

type Num = number | null | undefined;

export function fmt(n: Num): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return Number(n).toLocaleString('en-US');
}

export function fmtGp(n: Num): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return `${fmt(Math.round(n))} gp`;
}

function trimOne(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '');
}

// Compact labels for dense tables and chart axes: 1.2m / 450k / 1.2b.
export function fmtGpShort(n: Num): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    const v = abs / 1_000_000_000;
    return `${sign}${v >= 10 ? v.toFixed(0) : v.toFixed(1)}b`;
  }
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    return `${sign}${v >= 10 ? trimOne(v) : v.toFixed(1)}m`;
  }
  if (abs >= 1_000) {
    const v = abs / 1_000;
    return `${sign}${v >= 10 ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

export function fmtPct(n: Num): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function fmtTime(unixSec: Num): string {
  if (!unixSec) return 'n/a';
  return new Date(unixSec * 1000).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

// Same date formatting as fmtTime, but for the ISO syncedAt string the sync
// endpoints return (Character's Quests/Collection Log tabs and Leagues both
// show "last synced").
export function fmtSyncedAt(iso: string): string {
  if (!iso) return 'n/a';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
}

function ageSeconds(unixSec: Num): number | null {
  if (!unixSec) return null;
  return Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
}

// "7m ago", from a duration already measured in seconds - what flip rows carry.
//
// This used to accept a timestamp too, guessing which the caller meant from
// two magic thresholds: anything over 1e8 was read as a timestamp, so a
// duration of 3.2 years or more silently became a date. Call sites always know
// which one they hold, so they say.
export function fmtAgo(seconds: Num): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return 'n/a';
  const sec = Math.max(0, Math.floor(seconds));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// Same label, from a unix timestamp - what the item page's trade tiles carry.
export function fmtAgoSince(unixSec: Num): string {
  return fmtAgo(ageSeconds(unixSec));
}

// Green / amber / red for last-traded age tiles (fresh ≤10m, stale >30m).
export function agoClass(unixSec: Num): string {
  const sec = ageSeconds(unixSec);
  if (sec === null) return '';
  if (sec <= 10 * 60) return 'up';
  if (sec <= 30 * 60) return 'ago-amber';
  return 'down';
}

export function pctClass(n: Num): string {
  return n === null || n === undefined || Number.isNaN(n) ? '' : n >= 0 ? 'up' : 'down';
}

// Everything in this app renders via innerHTML, so interpolated names
// (search results, flip table) need escaping.
export function escapeHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Web storage is not always available or writable: a locked-down or private
// browsing context can throw on the very first access, and setItem throws
// QuotaExceededError once a store is full. Both are recoverable - a lost
// preference is not worth taking a page down for - but only if every access
// goes through here. Reads fall back, writes report whether they landed.
export function storageGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(store: Storage, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // Nothing to recover: the value is already unreadable to us.
  }
}

export const API_TOKEN_KEY = 'osrs_api_token';
export const UNAUTHORIZED_HINT =
  'Unauthorized. Sign in on this site, or open the tracker on your LAN host to pick up its API token.';

export function apiAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = storageGet(localStorage, API_TOKEN_KEY)?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Fetch + parse, leaving the ok/error decision to the caller - some pages
// (collection log) treat a particular status code as a non-error case rather
// than throwing, so this can't own that decision itself.
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    ...init,
    headers: { ...apiAuthHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      'Server returned HTML instead of JSON. Stop the running tracker, run npm start again, then retry.',
    );
  }
  const data = (await res.json()) as T;
  if (res.status === 401) {
    return { ok: false, status: 401, data: { ...(data as object), error: UNAUTHORIZED_HINT } as T };
  }
  return { ok: res.ok, status: res.status, data };
}

// Every page's catch block reduces an unknown error the same way; only the
// per-call fallback text differs.
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Typed getElementById - avoids repeating `document.getElementById(x) as Y` casts.
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// "Press Enter in the field, or click the button" - the same pair of
// listeners every page's search box wires up.
export function onEnterOrClick(input: HTMLInputElement, button: HTMLElement, action: () => void): void {
  button.addEventListener('click', action);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') action();
  });
}

export interface FilterOption<T extends string> {
  key: T;
  label: string;
}

export interface FilterGroup<T extends string> {
  /** Marks a key active, applies it, and refreshes. */
  select: (key: T) => void;
  /** Replaces the buttons - for rows whose options come from server data. */
  setOptions: (options: FilterOption<T>[]) => void;
}

// A row of filter buttons: renders them, tracks which one is active, and runs
// the caller's apply + refresh callbacks on every click.
//
// Used for every filter row in the app - the Quests tab's per-dimension
// options, both pages' top-level "which dimension" strip, and the Leagues
// page's region/difficulty/activityType rows. The last of those are rebuilt
// from each response rather than fixed, which is why setOptions exists; that
// case used to be a near-identical private copy of this function in leagues.ts,
// with a comment on each side explaining why there were two.
export function wireFilterGroup<T extends string>(
  el: HTMLElement,
  options: FilterOption<T>[],
  apply: (key: T) => void,
  onSelect: () => void
): FilterGroup<T> {
  const select = (key: T): void => {
    apply(key);
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === key);
    });
    onSelect();
  };

  const setOptions = (next: FilterOption<T>[]): void => {
    el.innerHTML = next
      .map((o) => `<button data-filter="${escapeHtml(o.key)}">${escapeHtml(o.label)}</button>`)
      .join('');
  };

  // Delegated, so rebuilt buttons stay live without re-wiring.
  el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (btn?.dataset.filter) select(btn.dataset.filter as T);
  });

  setOptions(options);
  return { select, setOptions };
}

// Gold dot on a top-tier filter-dimension tab whose child filter isn't at
// its default value, so a narrowed row that's currently hidden behind
// another tab doesn't look like the list is just unfiltered.
export function markNarrowedDimensions<K extends string>(tabsEl: HTMLElement, isNarrowed: (key: K) => boolean): void {
  tabsEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.classList.toggle('has-filter', isNarrowed(b.dataset.filter as K));
  });
}

// The "set up plugin sync" steps shared by sync-help blocks on Character and
// Leagues pages - identical everywhere except what the Sync URL points at.
export function syncSetupStepsHtml(syncButtonLabel = 'Sync Everything'): string {
  return `
    <li>In RuneLite, open the <strong>Leagues Tasks</strong> sidebar and go to <strong>Sync Settings</strong>.</li>
    <li>Set <strong>Server URL</strong> to this tracker&apos;s base URL (for example <code>http://localhost:4123</code>, or HTTPS / your LAN address).</li>
    <li>Set <strong>API Token</strong> to the value from <strong>Copy plugin token</strong> in the tracker header (LAN hosts fill the browser in automatically; public hosts show it after sign-in).</li>
    <li>Under <strong>Sync to Website</strong>, click <strong>${syncButtonLabel}</strong> while logged in on that character.</li>`;
}
