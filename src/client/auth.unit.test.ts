/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, type Route } from './pageHarness.test.js';

// auth.ts keeps the server's status and the portfolio name for the life of the module, so each case gets its own copy.
let copies = 0;
async function freshAuth(): Promise<typeof import('./auth.js')> {
  return (await import(`./auth.js?copy=${++copies}`)) as typeof import('./auth.js');
}

test('a status the server cannot give reads as guest', async () => {
  const failures: Route[] = [{ status: 500, body: {} }, { html: '<p>proxy</p>' }, () => { throw new Error('offline'); }];
  for (const route of failures) {
    loadPage('index.html', { routes: { 'GET /api/auth/status': route } });
    const auth = await freshAuth();
    assert.deepEqual(await auth.loadAuthStatus(), { mode: 'guest', accounts: false });
  }
});

test('a sign-in answer without a token and user fails, and a refusal with no reason gets a general one', async () => {
  const page = loadPage('index.html', {
    routes: {
      'POST /api/auth/login': { body: { token: 'half-an-answer' } },
      'POST /api/auth/register': { status: 500, body: {} },
    },
  });
  const auth = await freshAuth();
  await assert.rejects(auth.loginAccount('pilot', 'secret'), { message: 'Sign in failed' });
  assert.equal(page.window.localStorage.getItem('osrs_api_token'), null);
  await assert.rejects(auth.registerAccount('pilot', 'secret', 'Pet?', 'Rex'), { message: 'Request failed' });
});

test('a plugin token the server will not mint says why', async () => {
  const page = loadPage('index.html', { routes: { 'POST /api/auth/token': { status: 403, body: { error: 'Accounts only' } } } });
  const auth = await freshAuth();
  await assert.rejects(auth.mintPluginToken(), { message: 'Accounts only' });
  page.routes['POST /api/auth/token'] = { body: {} };
  await assert.rejects(auth.mintPluginToken(), { message: 'Could not mint a plugin token' });
});

test('copying falls back to a hidden text box when the clipboard API is missing', async () => {
  const page = loadPage('index.html');
  const copied: string[] = [];
  page.window.document.execCommand = ((command: string) => {
    copied.push(`${command}:${page.window.document.querySelector('textarea')?.value}`);
    return true;
  }) as typeof page.window.document.execCommand;
  const auth = await freshAuth();
  await auth.copyText('plugin-token');
  assert.deepEqual(copied, ['copy:plugin-token']);
  assert.equal(page.window.document.querySelector('textarea'), null);
});

test('the portfolio name is unknown when the portfolio cannot be reached', async () => {
  loadPage('index.html', { routes: { 'GET http://portfolio.test/sso/me': () => { throw new Error('offline'); } } });
  const auth = await freshAuth();
  assert.equal(await auth.portfolioName('http://portfolio.test'), null);
});

test('a status answer with no content type reads as guest', async () => {
  loadPage('index.html');
  globalThis.fetch = async () => new Response(null, { status: 200 });
  const auth = await freshAuth();
  assert.deepEqual(await auth.loadAuthStatus(), { mode: 'guest', accounts: false });
});

test('nobody is signed in when the server refuses /api/auth/me', async () => {
  loadPage('index.html', { routes: { 'GET /api/auth/me': { status: 401, body: { error: 'Sign in first' } } } });
  const auth = await freshAuth();
  assert.equal(await auth.fetchMe(), null);
});

test('the sign-in links offer the portfolio only when the server has it', async () => {
  const page = loadPage('index.html');
  const auth = await freshAuth();
  const buttons = (html: string) => {
    page.window.document.body.innerHTML = html;
    return [...page.window.document.querySelectorAll('button')].map((b) => b.id);
  };
  assert.deepEqual(buttons(auth.authLinksHtml()), ['authLoginBtn', 'authRegisterBtn']);
  assert.deepEqual(buttons(auth.authLinksHtml(true)), ['authLoginBtn', 'authPortfolioBtn', 'authRegisterBtn']);
});

test('the portfolio name is unknown when the portfolio refuses or names nobody', async () => {
  for (const route of [{ status: 401, body: {} }, { body: {} }, { body: { username: '' } }, { body: { username: 7 } }]) {
    loadPage('index.html', { routes: { 'GET http://portfolio.test/sso/me': route } });
    const auth = await freshAuth();
    assert.equal(await auth.portfolioName('http://portfolio.test'), null, JSON.stringify(route));
  }
});

test('the portfolio button still logs in when the portfolio address is not known', async () => {
  const page = loadPage('index.html');
  const auth = await freshAuth();
  const btn = page.window.document.createElement('button');
  btn.textContent = 'Log in with portfolio account';
  auth.wirePortfolioButton(btn, undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(btn.textContent, 'Log in with portfolio account');
  assert.deepEqual(page.requests.map((r) => r.url), []);
  btn.click();
  assert.equal(page.navigations.length, 1);
});
