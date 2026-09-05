import { API_TOKEN_KEY, escapeHtml, fetchJson, storageGet, storageRemove, storageSet } from './format.js';

export type AuthStatus = {
  mode: 'guest' | 'public' | 'lan';
  accounts: boolean;
  // LAN posture only: the wildcard token this host mints. The browser stores it
  // automatically (same-origin on a LAN host) so no one has to paste it.
  lanToken?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  rsns: string[];
};

let cachedStatus: AuthStatus | null = null;

const LEGACY_OPEN: AuthStatus = { mode: 'guest', accounts: false };

export async function loadAuthStatus(): Promise<AuthStatus> {
  if (cachedStatus) return cachedStatus;
  try {
    const res = await fetch('/api/auth/status');
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.includes('application/json')) {
      cachedStatus = LEGACY_OPEN;
      return cachedStatus;
    }
    cachedStatus = (await res.json()) as AuthStatus;
    return cachedStatus;
  } catch {
    cachedStatus = LEGACY_OPEN;
    return cachedStatus;
  }
}

export function clearAuthStatusCache(): void {
  cachedStatus = null;
}

const PLACEHOLDER_TOKENS = new Set(['your-token', 'your-secret-here', 'your-secret']);

export function isPlaceholderToken(token: string): boolean {
  return PLACEHOLDER_TOKENS.has(token.trim().toLowerCase());
}

export function getStoredToken(): string {
  const token = storageGet(localStorage, API_TOKEN_KEY)?.trim() ?? '';
  if (token && isPlaceholderToken(token)) {
    storageRemove(localStorage, API_TOKEN_KEY);
    return '';
  }
  return token;
}

export function setStoredToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed && isPlaceholderToken(trimmed)) return false;
  if (trimmed) storageSet(localStorage, API_TOKEN_KEY, trimmed);
  else storageRemove(localStorage, API_TOKEN_KEY);
  // Read back rather than trusting the write: a store that silently drops
  // values would otherwise leave the caller thinking the token was saved.
  return getStoredToken() === trimmed;
}

export async function registerAccount(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const { ok, data } = await fetchJson<{ token?: string; user?: AuthUser; error?: string }>(
    '/api/auth/register',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!ok || !data.token || !data.user) {
    throw new Error(data.error ?? 'Registration failed');
  }
  setStoredToken(data.token);
  return { token: data.token, user: data.user };
}

export async function loginAccount(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const { ok, data } = await fetchJson<{ token?: string; user?: AuthUser; error?: string }>(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!ok || !data.token || !data.user) {
    throw new Error(data.error ?? 'Login failed');
  }
  setStoredToken(data.token);
  return { token: data.token, user: data.user };
}

export async function fetchMe(): Promise<AuthUser | null> {
  const { ok, data } = await fetchJson<AuthUser & { error?: string }>('/api/auth/me');
  return ok ? data : null;
}

export async function mintPluginToken(): Promise<string> {
  const { ok, data } = await fetchJson<{ token?: string; error?: string }>('/api/auth/token', { method: 'POST' });
  if (!ok || !data.token) {
    throw new Error(data.error ?? 'Could not mint a plugin token');
  }
  setStoredToken(data.token);
  return data.token;
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export function authPanelHtml(): string {
  return `
    <div id="authPanel" class="auth-panel">
      <form id="authForm" class="auth-form">
        <input id="authEmail" type="email" placeholder="Email" autocomplete="username" />
        <input id="authPassword" type="password" placeholder="Password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
        <button id="authRegisterBtn" type="button">Register</button>
      </form>
      <p id="authMessage" class="auth-message" hidden></p>
    </div>`;
}

// An RSN is claimed by syncing from the plugin while logged into that
// character - that sync carries the Jagex accountHash, which is the only
// ownership proof this app can get. There is deliberately no browser-side way
// to claim a name, so this is a status readout, not a control.
export function accountChipHtml(user: AuthUser, playingAsClaimed = false): string {
  const claimStatus = playingAsClaimed
    ? '<span class="session-claim is-claimed">Claimed</span>'
    : '<span class="session-claim" title="Sync from the plugin while logged into this character to claim it.">Sync to claim</span>';
  return `
    <span class="session-account">Signed in as <strong>${escapeHtml(user.email)}</strong></span>
    <button id="authCopyTokenBtn" type="button">Copy plugin token</button>
    ${claimStatus}
    <button id="authSignOutBtn" type="button">Sign out</button>`;
}
