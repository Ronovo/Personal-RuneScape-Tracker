import { API_TOKEN_KEY, escapeHtml, fetchJson, storageGet, storageRemove, storageSet } from './format.js';
import { MAX_SECURITY_ANSWER, SECURITY_QUESTIONS } from '../shared/securityQuestions.js';

export type AuthStatus = {
  mode: 'guest' | 'public' | 'lan';
  accounts: boolean;
  // LAN posture only: the wildcard token this host mints. The browser stores it
  // automatically (same-origin on a LAN host) so no one has to paste it.
  lanToken?: string;
  ronovo?: boolean;
};

export type AuthUser = {
  id: string;
  username: string;
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

type SignIn = { token: string; user: AuthUser; needsSecurityQuestion: boolean };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const { ok, data } = await fetchJson<T & { error?: string }>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!ok) {
    throw new Error(data.error ?? 'Request failed');
  }
  return data;
}

async function signIn(url: string, body: unknown): Promise<SignIn> {
  const data = await postJson<{ token?: string; user?: AuthUser; needsSecurityQuestion?: boolean }>(url, body);
  if (!data.token || !data.user) {
    throw new Error('Sign in failed');
  }
  setStoredToken(data.token);
  return { token: data.token, user: data.user, needsSecurityQuestion: Boolean(data.needsSecurityQuestion) };
}

export function registerAccount(username: string, password: string, question: string, answer: string): Promise<SignIn> {
  return signIn('/api/auth/register', { username, password, question, answer });
}

export function loginAccount(username: string, password: string): Promise<SignIn> {
  return signIn('/api/auth/login', { username, password });
}

/** Trades the one-time code the Ronovo callback put in the URL for this app's API token. */
export async function ronovoLogin(code: string): Promise<AuthUser> {
  return (await signIn('/api/auth/ronovo', { code })).user;
}

export async function saveSecurityQuestion(question: string, answer: string): Promise<void> {
  await postJson('/api/auth/security-question', { question, answer });
}

export async function resetQuestion(username: string): Promise<string> {
  return (await postJson<{ question: string }>('/api/auth/reset-question', { username })).question;
}

export async function resetPassword(username: string, answer: string, password: string): Promise<void> {
  await postJson('/api/auth/reset-password', { username, answer, password });
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

function questionSelectHtml(id: string): string {
  const options = SECURITY_QUESTIONS.map((q) => `<option>${escapeHtml(q)}</option>`).join('');
  return `<select id="${id}" aria-label="Security question"><option value="">Security question (to register)</option>${options}</select>`;
}

export function authPanelHtml(ronovo = false): string {
  return `
    <div id="authPanel" class="auth-panel">
      ${ronovo ? '<button id="authRonovoBtn" type="button">Log in with Ronovo</button>' : ''}
      <form id="authForm" class="auth-form">
        <input id="authUsername" type="text" placeholder="Username" autocomplete="username" />
        <input id="authPassword" type="password" placeholder="Password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
        ${questionSelectHtml('authQuestion')}
        <input id="authAnswer" type="text" placeholder="Security answer" autocomplete="off" maxlength="${MAX_SECURITY_ANSWER}" />
        <button id="authRegisterBtn" type="button">Register</button>
        <button id="authForgotBtn" type="button">Forgot password?</button>
      </form>
      <p id="authMessage" class="auth-message" hidden></p>
    </div>`;
}

// Two steps: the username brings up its security question, then the answer
// and a new password change it.
export function resetPanelHtml(): string {
  return `
    <div id="authPanel" class="auth-panel">
      <form id="resetForm" class="auth-form">
        <input id="resetUsername" type="text" placeholder="Username" autocomplete="username" />
        <span id="resetQuestion" class="session-account" hidden></span>
        <input id="resetAnswer" type="text" placeholder="Security answer" autocomplete="off" maxlength="${MAX_SECURITY_ANSWER}" hidden />
        <input id="resetPassword" type="password" placeholder="New password" autocomplete="new-password" hidden />
        <button id="resetSubmitBtn" type="submit">Next</button>
        <button id="resetBackBtn" type="button">Back</button>
      </form>
      <p id="authMessage" class="auth-message" hidden></p>
    </div>`;
}

// Accounts made before security questions set one straight after signing in.
export function securityPanelHtml(): string {
  return `
    <div id="authPanel" class="auth-panel">
      <form id="securityForm" class="auth-form">
        ${questionSelectHtml('securityQuestion')}
        <input id="securityAnswer" type="text" placeholder="Security answer" autocomplete="off" maxlength="${MAX_SECURITY_ANSWER}" />
        <button type="submit">Save security question</button>
      </form>
      <p id="authMessage" class="auth-message">Pick a security question. You need its answer to reset your password.</p>
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
    <span class="session-account">Signed in as <strong>${escapeHtml(user.username)}</strong></span>
    <button id="authCopyTokenBtn" type="button">Copy plugin token</button>
    ${claimStatus}
    <button id="authSignOutBtn" type="button">Sign out</button>`;
}
