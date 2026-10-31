/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle } from './pageHarness.test.js';

const GUEST = { 'GET /api/auth/status': { body: { mode: 'guest', accounts: false } } };
const TABS = ['Character', 'Leagues Tasks', 'Grand Exchange', 'Flip Helper'];

test('the landing page lists every tab as a card, and no tab is marked current', async () => {
  const page = loadPage('index.html', { routes: GUEST });
  await runScript(page, './chrome.js');
  const { document } = page.window;
  assert.deepEqual([...document.querySelectorAll('header nav a')].map((a) => a.textContent), TABS);
  assert.equal(document.querySelectorAll('header nav a.active').length, 0);
  assert.deepEqual([...document.querySelectorAll('#homeLinks .home-link-title')].map((a) => a.textContent), TABS);
  assert.ok(document.querySelector('#homeLinks .home-link-blurb')?.textContent?.includes('hiscores'));
});

test('the tab for the current page is marked, and an item page counts as the Grand Exchange', async () => {
  for (const [file, active] of [['flip.html', 'Flip Helper'], ['item.html', 'Grand Exchange']]) {
    const page = loadPage(file!, { routes: GUEST });
    await runScript(page, './chrome.js');
    assert.deepEqual([...page.window.document.querySelectorAll('header nav a.active')].map((a) => a.textContent), [active]);
  }
});

test('a guest picks who they are playing as, from the names used before', async () => {
  const page = loadPage('index.html', {
    routes: GUEST, storage: { osrs_known_users: JSON.stringify(['Zezima', 'Lynx Titan']) },
  });
  await runScript(page, './chrome.js');
  const options = [...page.window.document.querySelectorAll('#sessionKnownUsers option')];
  assert.deepEqual(options.map((o) => o.getAttribute('value')), ['Zezima', 'Lynx Titan']);
  assert.equal(page.window.document.getElementById('authPanel'), null);

  byId<HTMLInputElement>(page, 'sessionUsernameInput').value = '  B0aty ';
  click(page, 'sessionSetBtn');
  await settle();
  assert.equal(page.window.document.querySelector('.session-identity-name strong')?.textContent, 'B0aty');
  assert.equal(page.window.localStorage.getItem('osrs_current_user'), 'B0aty');

  click(page, 'sessionSwitchBtn');
  await settle();
  const input = byId<HTMLInputElement>(page, 'sessionUsernameInput');
  input.value = 'Woox';
  input.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'a' }));
  await settle();
  assert.equal(page.window.localStorage.getItem('osrs_current_user'), null);
  input.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter' }));
  await settle();
  assert.equal(page.window.document.querySelector('.session-identity-name strong')?.textContent, 'Woox');
});

test('a portfolio login code on a server without accounts is dropped quietly', async () => {
  const page = loadPage('index.html', { search: '?portfolio=abc&tab=1', routes: GUEST });
  await runScript(page, './chrome.js');
  assert.equal(page.window.location.search, '?tab=1');
  assert.equal(page.window.document.querySelector('#authMessage'), null);
  assert.ok(page.window.document.querySelector('#sessionUsernameInput'));
});

test('a page without the header pieces still loads', async () => {
  const page = loadPage('index.html', { routes: GUEST });
  page.window.document.body.innerHTML = '<main></main>';
  await runScript(page, './chrome.js');
  assert.equal(page.window.document.querySelector('nav'), null);
});
