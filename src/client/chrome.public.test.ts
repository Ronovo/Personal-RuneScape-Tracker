/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle, type Route } from './pageHarness.test.js';

const STATUS = {
  'GET /api/auth/status': { body: { mode: 'public', accounts: true, portfolio: true, portfolioUrl: 'http://portfolio.test' } },
  'GET http://portfolio.test/sso/me': { body: { username: 'Gambler' } },
};
const USER = { id: 'u1', username: 'pilot', rsns: ['zezima'] };

function signedIn(extra: Record<string, Route> = {}, storage: Record<string, string> = {}) {
  return loadPage('index.html', {
    routes: { ...STATUS, 'GET /api/auth/me': { body: USER }, 'POST /api/auth/bankrolls': { body: { bankrolls: {} } }, ...extra },
    storage: { osrs_api_token: 'account-token', ...storage },
  });
}

test('a signed-out visitor is offered log in, the portfolio and register, but not Playing as', async () => {
  const page = loadPage('index.html', { routes: STATUS });
  await runScript(page, './chrome.js');
  assert.equal(page.window.document.getElementById('sessionUsernameInput'), null);
  assert.equal(byId(page, 'authPortfolioBtn').textContent, 'Log in as Gambler');
  click(page, 'authLoginBtn');
  click(page, 'authRegisterBtn');
  click(page, 'authPortfolioBtn');
  assert.equal(page.navigations.length, 3);
});

test('a signed-in account sees its name and whether Playing as is claimed', async () => {
  const page = signedIn({}, { osrs_current_user: 'Zezima' });
  await runScript(page, './chrome.js');
  const { document } = page.window;
  assert.equal(document.querySelector('.session-account strong')?.textContent, 'pilot');
  assert.equal(document.querySelector('.session-claim')?.textContent, 'Claimed');
  assert.equal(page.requests.find((r) => r.url === '/api/auth/bankrolls')?.method, 'POST');

  click(page, 'sessionSwitchBtn');
  await settle();
  byId<HTMLInputElement>(page, 'sessionUsernameInput').value = 'Lynx Titan';
  click(page, 'sessionSetBtn');
  await settle();
  assert.equal(document.querySelector('.session-claim')?.textContent, 'Sync to claim');
});

test('signing out forgets the token and offers log in again', async () => {
  const page = signedIn();
  await runScript(page, './chrome.js');
  page.routes['GET /api/auth/me'] = { status: 401, body: { error: 'Unauthorized' } };
  click(page, 'authSignOutBtn');
  await settle();
  assert.equal(page.window.localStorage.getItem('osrs_api_token'), null);
  assert.ok(page.window.document.getElementById('authLoginBtn'));
});

test('an account token mints and copies a fresh plugin token', async () => {
  const page = signedIn({ 'POST /api/auth/token': { body: { token: 'plugin-token' } } });
  const copied: string[] = [];
  Object.defineProperty(page.window.navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) } });
  await runScript(page, './chrome.js');
  click(page, 'authCopyTokenBtn');
  await settle();
  assert.deepEqual(copied, ['plugin-token']);
  assert.equal(page.window.localStorage.getItem('osrs_api_token'), 'plugin-token');
});

test('a portfolio login code is used once and taken out of the address bar', async () => {
  const page = loadPage('index.html', {
    search: '?portfolio=CODE&tab=x#top',
    routes: {
      ...STATUS,
      'POST /api/auth/portfolio': (body) => ({ body: { token: 'portfolio-token', user: { ...USER, username: (body as { code: string }).code } } }),
      'GET /api/auth/me': { body: { ...USER, username: 'CODE' } },
      'POST /api/auth/bankrolls': { body: { bankrolls: {} } },
    },
  });
  await runScript(page, './chrome.js');
  assert.equal(page.window.location.search, '?tab=x');
  assert.equal(page.window.location.hash, '#top');
  assert.equal(page.window.localStorage.getItem('osrs_api_token'), 'portfolio-token');
  assert.equal(page.window.document.querySelector('.session-account strong')?.textContent, 'CODE');
});

test('a portfolio login that fails says why', async () => {
  const page = loadPage('index.html', {
    search: '?portfolio=OLD',
    routes: { ...STATUS, 'POST /api/auth/portfolio': { status: 400, body: { error: 'Portfolio login expired.' } } },
  });
  await runScript(page, './chrome.js');
  assert.equal(page.window.location.search, '');
  const message = byId(page, 'authMessage');
  assert.equal(message.hidden, false);
  assert.equal(message.textContent, 'Portfolio login expired.');
  assert.ok(message.classList.contains('error'));
});

test('bankrolls kept on the account replace this browser\'s and redraw the page', async () => {
  const page = signedIn({
    'POST /api/auth/bankrolls': { body: { bankrolls: { zezima: { value: 5000, savedAt: 2 }, guest: { value: 10, savedAt: 1 } } } },
  }, { 'osrs_bankroll::guest': '10', osrs_current_user: 'Zezima' });
  let redraws = 0;
  page.window.addEventListener('osrs-session-change', () => redraws++);
  await runScript(page, './chrome.js');
  assert.equal(page.window.localStorage.getItem('osrs_bankroll::zezima'), '5000');
  assert.equal(redraws, 1);
});
