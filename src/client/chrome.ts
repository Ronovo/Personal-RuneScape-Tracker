// The page header every page shares: nav tabs, the landing page's cards, the
// "Playing as" control and the account/auth panel. Imported for its side effect
// by pages that need nothing else from it.
//
// The identity itself, and the watchlist and bankroll keyed by it, live in
// identity.ts. This module reads that state and re-renders when it changes.

import { escapeHtml } from './format.js';
import {
  SESSION_CHANGE_EVENT, clearUsername, emitSessionChange, getKnownUsers, getUsername, setUsername
} from './identity.js';
import {
  accountChipHtml,
  authPanelHtml,
  copyText,
  fetchMe,
  getStoredToken,
  loadAuthStatus,
  loginAccount,
  mintPluginToken,
  registerAccount,
  setStoredToken,
  type AuthStatus,
  type AuthUser,
} from './auth.js';

type NavLink = { href: string; label: string; blurb: string; alsoActive?: string[] };

// Single source of truth for header tabs — add new pages here and in public/*.html.
// `blurb` is one line describing the tab; the landing page cards are built from
// it, so a new tab shows up there without touching index.html.
const NAV_LINKS: NavLink[] = [
  {
    href: 'character.html',
    label: 'Character',
    blurb: "Look up a player's hiscores — skills, bosses, minigames — plus synced quests, diaries, combat achievements and collection log."
  },
  {
    href: 'leagues.html',
    label: 'Leagues Tasks',
    blurb: 'Browse completed Leagues Task Randomizer tasks, filtered by region, difficulty and activity type.'
  },
  {
    href: 'ge.html',
    label: 'Grand Exchange',
    blurb: "Browse the market: search any item, or see what's rising, dropping and most heavily traded over the last 24 hours.",
    alsoActive: ['item.html']
  },
  {
    href: 'flip.html',
    label: 'Flip Helper',
    blurb: 'Find and evaluate flips by margin, ROI or GP/hr, with a bankroll calculator and a watchlist.'
  },
];

let authStatus: AuthStatus | null = null;
let authUser: AuthUser | null = null;

function currentPage(): string {
  const path = location.pathname;
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

// Fills the empty <nav> in each page header from NAV_LINKS.
function mountNav(): void {
  const nav = document.querySelector('header nav');
  if (!nav) return;

  const page = currentPage();
  nav.innerHTML = NAV_LINKS.map(({ href, label, alsoActive }) => {
    const active = page === href || (alsoActive?.includes(page) ?? false);
    const cls = active ? ' class="active"' : '';
    return `<a href="${href}"${cls}>${escapeHtml(label)}</a>`;
  }).join('');
}

// Landing page only: the same tabs as cards, so there is somewhere to read
// what each one is for before clicking into it.
function mountHomeLinks(): void {
  const host = document.getElementById('homeLinks');
  if (!host) return;

  host.innerHTML = NAV_LINKS.map(({ href, label, blurb }) => `
    <a class="home-link" href="${href}">
      <span class="home-link-title">${escapeHtml(label)}</span>
      <span class="home-link-blurb">${escapeHtml(blurb)}</span>
    </a>`).join('');
}

function showAuthMessage(text: string, isError = false): void {
  const el = document.getElementById('authMessage');
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// LAN posture: the browser already holds the wildcard token (auto-stored from
// /api/auth/status). This chip just copies it into RuneLite via the shared
// #authCopyTokenBtn handler wired in wireAccountButtons().
function mountLanTokenChip(el: HTMLElement): void {
  const wrap = document.createElement('span');
  wrap.className = 'session-token';
  wrap.innerHTML = '<button id="authCopyTokenBtn" type="button">Copy plugin token</button>';
  el.appendChild(wrap);
}

function rsnKey(name: string): string {
  return name.replace(/\u00a0/g, ' ').trim().toLowerCase();
}

function isPlayingAsClaimed(username: string | null): boolean {
  if (!username || !authUser) return false;
  const key = rsnKey(username);
  return authUser.rsns.some((rsn) => rsn === key);
}

const COPY_BTN_LABEL = 'Copy plugin token';
let copyLabelTimer: number | undefined;

function clearCopyTimer(): void {
  if (copyLabelTimer !== undefined) {
    window.clearTimeout(copyLabelTimer);
    copyLabelTimer = undefined;
  }
}

function flashCopyButton(btn: HTMLButtonElement, text: string, isError: boolean, revertMs: number): void {
  clearCopyTimer();
  btn.textContent = text;
  btn.disabled = false;
  btn.classList.toggle('error', isError);
  copyLabelTimer = window.setTimeout(() => {
    copyLabelTimer = undefined;
    if (document.getElementById('authCopyTokenBtn') !== btn) return;
    btn.textContent = COPY_BTN_LABEL;
    btn.disabled = false;
    btn.classList.remove('error');
  }, revertMs);
}

function wireAccountButtons(): void {
  clearCopyTimer();

  const copyBtn = document.getElementById('authCopyTokenBtn') as HTMLButtonElement | null;
  copyBtn?.addEventListener('click', () => void (async () => {
    if (copyBtn.disabled) return;
    copyBtn.disabled = true;
    try {
      const token = await mintPluginToken();
      await copyText(token);
      flashCopyButton(copyBtn, 'Token copied', false, 5000);
    } catch {
      flashCopyButton(copyBtn, 'Copy failed', true, 3000);
    }
  })());

  document.getElementById('authSignOutBtn')?.addEventListener('click', () => {
    setStoredToken('');
    authUser = null;
    emitSessionChange();
  });
}

function wireAuthForm(): void {
  const form = document.getElementById('authForm') as HTMLFormElement | null;
  const registerBtn = document.getElementById('authRegisterBtn');
  if (!form || !registerBtn) return;

  const submit = async (register: boolean) => {
    const email = (document.getElementById('authEmail') as HTMLInputElement).value.trim();
    const password = (document.getElementById('authPassword') as HTMLInputElement).value;
    try {
      const result = register ? await registerAccount(email, password) : await loginAccount(email, password);
      authUser = result.user;
      showAuthMessage(register ? 'Account created. Token saved for this browser.' : 'Signed in.');
      emitSessionChange();
    } catch (err) {
      showAuthMessage(err instanceof Error ? err.message : 'Auth failed', true);
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit(false);
  });
  registerBtn.addEventListener('click', () => void submit(true));
}

function playingAsHtml(username: string | null): string {
  if (username) {
    return `
      <span class="session-identity-name"><span class="session-identity-label">Playing as </span><strong>${escapeHtml(username)}</strong></span>
      <button id="sessionSwitchBtn" type="button">Switch</button>`;
  }
  const known = getKnownUsers();
  return `
      <input id="sessionUsernameInput" type="text" placeholder="Your OSRS name" autocomplete="off" list="sessionKnownUsers" />
      <datalist id="sessionKnownUsers">${known.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>
      <button id="sessionSetBtn" type="button">Play as</button>`;
}

function wirePlayingAs(username: string | null): void {
  if (username) {
    document.getElementById('sessionSwitchBtn')?.addEventListener('click', () => {
      clearUsername();
    });
    return;
  }

  const input = document.getElementById('sessionUsernameInput') as HTMLInputElement | null;
  const submit = () => setUsername(input?.value ?? '');
  document.getElementById('sessionSetBtn')?.addEventListener('click', submit);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

async function mountSessionBar(): Promise<void> {
  const el = document.getElementById('sessionBar');
  if (!el) return;

  authStatus ??= await loadAuthStatus();
  // LAN host: adopt the wildcard token it minted, unless a token is already set.
  if (authStatus.lanToken && !getStoredToken()) setStoredToken(authStatus.lanToken);

  if (authStatus.accounts && getStoredToken()) {
    authUser = await fetchMe();
  } else if (!getStoredToken()) {
    authUser = null;
  }

  const jwtMode = authStatus.accounts;
  const username = getUsername();
  // Public hosts hide Playing as until Sign in succeeds; LAN/guest always show it.
  const showPlayingAs = !jwtMode || Boolean(authUser);
  const identityParts: string[] = [];
  let authPanel = '';

  if (showPlayingAs) identityParts.push(playingAsHtml(username));

  if (jwtMode) {
    if (authUser) identityParts.push(accountChipHtml(authUser, isPlayingAsClaimed(username)));
    else authPanel = authPanelHtml();
  }

  el.innerHTML = [
    identityParts.length ? `<span class="session-identity">${identityParts.join('')}</span>` : '',
    authPanel,
  ].filter(Boolean).join('');

  if (showPlayingAs) wirePlayingAs(username);

  if (authStatus.mode === 'lan') mountLanTokenChip(el);
  wireAuthForm();
  wireAccountButtons();
}

async function mountChrome(): Promise<void> {
  mountNav();
  mountHomeLinks();
  await mountSessionBar();
}

document.addEventListener('DOMContentLoaded', () => {
  void mountChrome();
});

// Anything that changes the identity - here or on a page - re-renders the bar,
// so no caller has to remember to.
window.addEventListener(SESSION_CHANGE_EVENT, () => {
  void mountSessionBar();
});
