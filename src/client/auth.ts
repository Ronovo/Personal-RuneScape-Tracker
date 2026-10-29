import { API_TOKEN_KEY, escapeHtml, fetchJson, storageGet, storageRemove, storageSet } from './format.js';

export type AuthStatus = {
  mode: 'guest' | 'public' | 'lan';
  accounts: boolean;
  // LAN posture only: the wildcard token this host mints. The browser stores it
  // automatically (same-origin on a LAN host) so no one has to paste it.
  lanToken?: string;
  portfolio?: boolean;
  portfolioUrl?: string;
};

export type AuthUser = {
  id: string;
  username: string;
  rsns: string[];
};

let cachedStatus: AuthStatus | null = null;

// What a page assumes when /api/auth/status can't be read.
const GUEST_STATUS: AuthStatus = { mode: 'guest', accounts: false };

export async function loadAuthStatus(): Promise<AuthStatus> {
  if (cachedStatus) return cachedStatus;
  try {
    const res = await fetch('/api/auth/status');
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.includes('application/json')) {
      cachedStatus = GUEST_STATUS;
      return cachedStatus;
    }
    cachedStatus = (await res.json()) as AuthStatus;
    return cachedStatus;
  } catch {
    cachedStatus = GUEST_STATUS;
    return cachedStatus;
  }
}

export function getStoredToken(): string {
  return storageGet(localStorage, API_TOKEN_KEY)?.trim() ?? '';
}

export function setStoredToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed) storageSet(localStorage, API_TOKEN_KEY, trimmed);
  else storageRemove(localStorage, API_TOKEN_KEY);
  // Read back rather than trusting the write: a store that silently drops
  // values would otherwise leave the caller thinking the token was saved.
  return getStoredToken() === trimmed;
}

type SignIn = { token: string; user: AuthUser };

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
  const data = await postJson<{ token?: string; user?: AuthUser }>(url, body);
  if (!data.token || !data.user) {
    throw new Error('Sign in failed');
  }
  setStoredToken(data.token);
  return { token: data.token, user: data.user };
}

export function registerAccount(username: string, password: string, question: string, answer: string): Promise<SignIn> {
  return signIn('/api/auth/register', { username, password, question, answer });
}

export function loginAccount(username: string, password: string): Promise<SignIn> {
  return signIn('/api/auth/login', { username, password });
}

/** Trades the one-time code the portfolio login callback put in the URL for this app's API token. */
export async function portfolioLogin(code: string): Promise<AuthUser> {
  return (await signIn('/api/auth/portfolio', { code })).user;
}

/** The portfolio username of a first portfolio login waiting for the player to choose an account. */
export async function portfolioPending(code: string): Promise<string> {
  return (await postJson<{ username: string }>('/api/auth/portfolio/pending', { code })).username;
}

export function linkPortfolioAccount(code: string, username: string, password: string): Promise<SignIn> {
  return signIn('/api/auth/portfolio/link', { code, username, password });
}

export function newPortfolioAccount(code: string): Promise<SignIn> {
  return signIn('/api/auth/portfolio/new', { code });
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

export function authLinksHtml(portfolio = false): string {
  return `
    <div id="authPanel" class="auth-panel">
      <span class="auth-links">
        <button id="authLoginBtn" type="button">Log in</button>
        ${portfolio ? '<button id="authPortfolioBtn" type="button">Log in with portfolio account</button>' : ''}
        <button id="authRegisterBtn" type="button">Register</button>
      </span>
      <p id="authMessage" class="auth-message" hidden></p>
    </div>`;
}

let cachedPortfolioName: Promise<string | null> | null = null;

/** The portfolio account this browser is logged in to, or null when there is none or the portfolio can't be reached. */
export function portfolioName(portfolioUrl: string): Promise<string | null> {
  cachedPortfolioName ??= (async () => {
    try {
      const res = await fetch(`${portfolioUrl}/sso/me`, { credentials: 'include', signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const { username } = (await res.json()) as { username?: unknown };
      return typeof username === 'string' && username ? username : null;
    } catch {
      return null;
    }
  })();
  return cachedPortfolioName;
}

/** Sends the browser through portfolio login, and relabels the button "Log in as <name>" once the portfolio says who that is. */
export function wirePortfolioButton(btn: HTMLElement, portfolioUrl: string | undefined): void {
  btn.addEventListener('click', () => {
    location.href = '/sso/login';
  });
  if (!portfolioUrl) return;
  void portfolioName(portfolioUrl).then((name) => {
    if (name) btn.textContent = `Log in as ${name}`;
  });
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
