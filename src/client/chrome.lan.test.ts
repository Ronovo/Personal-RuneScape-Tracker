/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle } from './pageHarness.test.js';

const LAN = { 'GET /api/auth/status': { body: { mode: 'lan', accounts: false, lanToken: 'lan-token' } } };

function clipboard(page: ReturnType<typeof loadPage>, fail = false): string[] {
  const copied: string[] = [];
  Object.defineProperty(page.window.navigator, 'clipboard', {
    value: { writeText: async (text: string) => { if (fail) throw new Error('denied'); copied.push(text); } },
    configurable: true,
  });
  return copied;
}

test('a LAN host hands the browser its plugin token, and the chip copies it', async () => {
  const page = loadPage('index.html', {
    routes: { ...LAN, 'POST /api/auth/token': { body: { token: 'lan-token' } } },
  });
  const copied = clipboard(page);
  await runScript(page, './chrome.js');
  assert.equal(page.window.localStorage.getItem('osrs_api_token'), 'lan-token');
  assert.ok(page.window.document.getElementById('sessionUsernameInput'));

  click(page, 'authCopyTokenBtn');
  await settle();
  assert.deepEqual(copied, ['lan-token']);
  assert.equal(byId(page, 'authCopyTokenBtn').textContent, 'Token copied');
});

test('copying says so when it fails, and a second click while copying does nothing', async () => {
  const page = loadPage('index.html', { routes: { ...LAN, 'POST /api/auth/token': { status: 500, body: { error: 'down' } } } });
  clipboard(page);
  await runScript(page, './chrome.js');
  const button = byId<HTMLButtonElement>(page, 'authCopyTokenBtn');
  click(page, 'authCopyTokenBtn');
  click(page, 'authCopyTokenBtn');
  await settle();
  assert.equal(page.requests.filter((r) => r.url === '/api/auth/token').length, 1);
  assert.equal(button.textContent, 'Copy failed');
  assert.ok(button.classList.contains('error'));
});

test('a browser that already holds a token keeps it', async () => {
  const page = loadPage('index.html', { routes: LAN, storage: { osrs_api_token: 'my-token' } });
  await runScript(page, './chrome.js');
  assert.equal(page.window.localStorage.getItem('osrs_api_token'), 'my-token');
});

test('the copy button goes back to its label after a while, and copying again restarts the wait', async () => {
  const page = loadPage('index.html', { routes: { ...LAN, 'POST /api/auth/token': { body: { token: 'lan-token' } } } });
  clipboard(page);
  const waiting = new Map<number, () => void>();
  let ids = 0;
  const realSetTimeout = page.window.setTimeout.bind(page.window);
  page.window.setTimeout = ((fn: () => void, ms = 0) => {
    if (ms < 1000) return realSetTimeout(fn, ms);
    waiting.set(++ids, fn);
    return ids;
  }) as never;
  page.window.clearTimeout = ((id: number) => { waiting.delete(id); }) as never;
  await runScript(page, './chrome.js');
  const button = byId<HTMLButtonElement>(page, 'authCopyTokenBtn');
  click(page, 'authCopyTokenBtn');
  await settle();
  click(page, 'authCopyTokenBtn');
  await settle();
  assert.equal(waiting.size, 1);
  assert.equal(button.textContent, 'Token copied');
  [...waiting.values()].forEach((fn) => fn());
  assert.equal(button.textContent, 'Copy plugin token');
  assert.equal(button.disabled, false);

  click(page, 'authCopyTokenBtn');
  await settle();
  page.window.localStorage.setItem('osrs_current_user', 'Zezima');
  page.window.dispatchEvent(new page.window.Event('osrs-session-change'));
  await settle();
  assert.notEqual(byId(page, 'authCopyTokenBtn'), button);
  waiting.forEach((fn) => fn());
  assert.equal(button.textContent, 'Token copied');
});
