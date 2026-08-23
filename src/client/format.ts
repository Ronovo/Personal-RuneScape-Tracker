// Shared null-safe formatters, imported by every page script so character,
// collection log, GE, item, and Flip Helper all render numbers the same way.

const GE_TAX_RATE = 0.02;
const GE_TAX_CAP = 5_000_000;

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

function ageSeconds(unixSec: Num): number | null {
  if (!unixSec) return null;
  return Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
}

// Accepts either a unix timestamp or an already-computed age in seconds
// (flip rows send age; item tiles send highTime/lowTime).
export function fmtAgo(unixSec: Num): string {
  const sec = typeof unixSec === 'number' && unixSec < 1e10
    ? (unixSec > 1e8 ? ageSeconds(unixSec) : unixSec)
    : ageSeconds(unixSec);
  if (sec === null || Number.isNaN(sec)) return 'n/a';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
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
    .replace(/"/g, '&quot;');
}

// Mirrors src/lib/prices.ts geTax, without item-name exemptions — the
// calculator only has buy/sell numbers, not an item.
export function geTax(price: Num): number {
  if (!price) return 0;
  return Math.min(Math.floor(price * GE_TAX_RATE), GE_TAX_CAP);
}

// Fetch + parse, leaving the ok/error decision to the caller - some pages
// (collection log) treat a particular status code as a non-error case rather
// than throwing, so this can't own that decision itself.
export async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url);
  const data = (await res.json()) as T;
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
// listeners character.html and collectionlog.html's search boxes both wire up.
export function onEnterOrClick(input: HTMLInputElement, button: HTMLElement, action: () => void): void {
  button.addEventListener('click', action);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') action();
  });
}
