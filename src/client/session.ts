// Lightweight "who's playing" selector - not authentication, just a
// persisted client-side identity used to scope Flip watchlists/bankrolls
// and pre-fill username boxes. Everything lives in localStorage so it
// survives tab/browser closes until the player is explicitly switched.

import { safeJsonParse, escapeHtml } from './format.js';

const CURRENT_USER_KEY = 'osrs_current_user';
const KNOWN_USERS_KEY = 'osrs_known_users';
const KNOWN_USERS_MAX = 15;
const GUEST_BUCKET = '_guest_';

function readJson<T>(key: string, fallback: T): T {
  return safeJsonParse(localStorage.getItem(key), fallback);
}

function getUsername(): string | null {
  return localStorage.getItem(CURRENT_USER_KEY) || null;
}

// Pre-fills a username box from the current session, if one is set -
// character.html and collectionlog.html both do this on load.
export function prefillUsername(input: HTMLInputElement): void {
  const username = getUsername();
  if (username) input.value = username;
}

function getKnownUsers(): string[] {
  return readJson<string[]>(KNOWN_USERS_KEY, []);
}

function setUsername(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  localStorage.setItem(CURRENT_USER_KEY, trimmed);

  const known = [trimmed, ...getKnownUsers().filter((n) => n.toLowerCase() !== trimmed.toLowerCase())].slice(0, KNOWN_USERS_MAX);
  localStorage.setItem(KNOWN_USERS_KEY, JSON.stringify(known));

  mountSessionBar();
  window.dispatchEvent(new Event('osrs-session-change'));
}

// Scopes localStorage keys per "Playing as" identity, falling back to the guest bucket.
function userKey(prefix: string): string {
  return `${prefix}::${getUsername() || GUEST_BUCKET}`;
}

// Starred Flip Helper items, scoped per player (or guest).
export function getWatchlist(): number[] {
  return readJson<number[]>(userKey('osrs_flip_watchlist'), []);
}

export function toggleWatchlist(id: number): number[] {
  const numId = Number(id);
  const current = getWatchlist();
  const next = current.includes(numId)
    ? current.filter((x) => x !== numId)
    : [numId, ...current];
  localStorage.setItem(userKey('osrs_flip_watchlist'), JSON.stringify(next));
  return next;
}

// Bankroll for the Flip Helper "Fits My Bankroll" preset, same per-user bucket.
export function getBankroll(): number {
  const n = Number(localStorage.getItem(userKey('osrs_bankroll')));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setBankroll(n: number): number {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return getBankroll();
  localStorage.setItem(userKey('osrs_bankroll'), String(value));
  return value;
}

// Draws the "Playing as" chip / name box into #sessionBar on every page.
function mountSessionBar(): void {
  const el = document.getElementById('sessionBar');
  if (!el) return;

  const username = getUsername();

  if (username) {
    el.innerHTML = `
      <span>Playing as <strong>${escapeHtml(username)}</strong></span>
      <button id="sessionSwitchBtn" type="button">Switch</button>`;
    document.getElementById('sessionSwitchBtn')!.addEventListener('click', () => {
      localStorage.removeItem(CURRENT_USER_KEY);
      mountSessionBar();
      window.dispatchEvent(new Event('osrs-session-change'));
    });
    return;
  }

  const known = getKnownUsers();
  el.innerHTML = `
    <input id="sessionUsernameInput" type="text" placeholder="Your OSRS name" autocomplete="off" list="sessionKnownUsers" />
    <datalist id="sessionKnownUsers">${known.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>
    <button id="sessionSetBtn" type="button">Play as</button>`;

  const input = document.getElementById('sessionUsernameInput') as HTMLInputElement;
  const submit = () => setUsername(input.value);
  document.getElementById('sessionSetBtn')!.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

document.addEventListener('DOMContentLoaded', mountSessionBar);
