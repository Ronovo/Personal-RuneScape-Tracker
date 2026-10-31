import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_QUESTIONS } from '../shared/securityQuestions.js';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-portfolio-test-'));
const usersTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-portfolio-users-'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.SYNC_DATA_DIR = tmpDir;
process.env.USERS_DATA_DIR = usersTmp;
process.env.RATE_LIMIT_MAX = '0';
process.env.JWT_SECRET = 'portfolio-test-secret';
process.env.PORTFOLIO_SSO_URL = 'http://portfolio.test';
process.env.PORTFOLIO_SSO_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
delete process.env.LAN_MODE;

const { createApp } = await import('./app.js');

const app = createApp();
const server = app.listen(0);
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(usersTmp, { recursive: true, force: true });
  for (const key of ['JWT_SECRET', 'PORTFOLIO_SSO_URL', 'PORTFOLIO_SSO_PUBLIC_KEY']) delete process.env[key];
});

function portfolioToken(sub: string, { aud = 'osrs-tracker', expiresIn = '5m' } = {}): Promise<string> {
  return new SignJWT({ name: `player${sub}` })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('portfolio')
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

async function startLogin(): Promise<{ state: string; cookie: string }> {
  const res = await fetch(`${base}/sso/login`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location')!);
  assert.equal(location.origin + location.pathname, 'http://portfolio.test/sso/authorize');
  assert.equal(location.searchParams.get('app'), 'osrs-tracker');
  assert.equal(location.searchParams.get('return'), `${base}/sso/callback`);
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  return { state: location.searchParams.get('state')!, cookie };
}

async function callback(state: string, cookie: string, token: string): Promise<Response> {
  return fetch(`${base}/sso/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ state, token }),
  });
}

/** Where the callback sent the browser, and the code it carries. */
async function portfolioLogin(sub: string): Promise<{ page: string; code: string }> {
  const { state, cookie } = await startLogin();
  const res = await callback(state, cookie, await portfolioToken(sub));
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location')!, base);
  const param = location.pathname === '/link.html' ? 'link' : 'portfolio';
  return { page: location.pathname, code: location.searchParams.get(param)! };
}

const EXPIRED = 'Your portfolio login expired. Try again.';
const REJECTED = "That portfolio login didn't check out. Try again.";

/** The reason a failed callback sent the browser to the log in page with. */
function loginError(res: Response): string | null {
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location')!, base);
  assert.equal(location.pathname, '/login.html');
  return location.searchParams.get('error');
}

type LoginReply = { token: string; user: { id: string; username: string } };
type BankrollReply = { bankrolls: Record<string, { value: number; savedAt: number }> };

async function postJson(url: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

test('status offers portfolio login and the portfolio address when it is configured', async () => {
  const res = await fetch(`${base}/api/auth/status`);
  assert.deepEqual(await res.json(), { mode: 'public', accounts: true, portfolio: true, portfolioUrl: 'http://portfolio.test' });
  assert.ok(res.headers.get('content-security-policy')?.includes("connect-src 'self' http://portfolio.test;"));
});

test('callback sends a wrong state, another app\'s token and an expired token back to the log in page', async () => {
  const first = await startLogin();
  assert.equal(loginError(await callback('wrong', first.cookie, await portfolioToken('1'))), EXPIRED);
  const second = await startLogin();
  assert.equal(loginError(await callback(second.state, second.cookie, await portfolioToken('1', { aud: 'casino' }))), REJECTED);
  const third = await startLogin();
  assert.equal(loginError(await callback(third.state, third.cookie, await portfolioToken('1', { expiresIn: '-10s' }))), REJECTED);
});

test('the first portfolio login asks, then a new account is shared by every device', async () => {
  const { page, code } = await portfolioLogin('10');
  assert.equal(page, '/link.html');
  assert.deepEqual(await (await postJson('/api/auth/portfolio/pending', { code })).json(), { username: 'player10' });
  const first = await (await postJson('/api/auth/portfolio/new', { code })).json() as LoginReply;
  assert.equal(first.user.username, 'player10');
  assert.ok(first.token);
  assert.equal((await postJson('/api/auth/portfolio/new', { code })).status, 400, 'a used code is gone');

  const again = await portfolioLogin('10');
  assert.equal(again.page, '/');
  const second = await (await postJson('/api/auth/portfolio', { code: again.code })).json() as LoginReply;
  assert.equal(second.user.id, first.user.id);
  assert.equal((await postJson('/api/auth/portfolio', { code: again.code })).status, 400, 'a used code is gone');
});

test('an existing account can be linked once', async () => {
  const registered = await (await postJson('/api/auth/register', {
    username: 'linker', password: 'password1', question: SECURITY_QUESTIONS[0], answer: 'rex',
  })).json() as LoginReply;

  const { code } = await portfolioLogin('20');
  assert.equal((await postJson('/api/auth/portfolio/link', { code, username: 'linker', password: 'wrong' })).status, 401);
  const linked = await (await postJson('/api/auth/portfolio/link', { code, username: 'linker', password: 'password1' })).json() as LoginReply;
  assert.equal(linked.user.id, registered.user.id);

  const again = await portfolioLogin('20');
  assert.equal(again.page, '/');
  assert.equal((await (await postJson('/api/auth/portfolio', { code: again.code })).json() as LoginReply).user.id, registered.user.id);

  const other = await portfolioLogin('21');
  const res = await postJson('/api/auth/portfolio/link', { code: other.code, username: 'linker', password: 'password1' });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'That account is already linked to another portfolio account');
});

test('made-up codes are refused', async () => {
  assert.equal((await postJson('/api/auth/portfolio', { code: 'made-up' })).status, 400);
  assert.equal((await postJson('/api/auth/portfolio/pending', { code: 'made-up' })).status, 400);
  assert.equal((await postJson('/api/auth/portfolio/new', { code: 'made-up' })).status, 400);
});

test('bankrolls merge per player with the newer value winning', async () => {
  const { token } = await (await postJson('/api/auth/register', {
    username: 'bank', password: 'password1', question: SECURITY_QUESTIONS[0], answer: 'rex',
  })).json() as LoginReply;
  assert.equal((await postJson('/api/auth/bankrolls', { bankrolls: {} })).status, 401);

  const first = await (await postJson('/api/auth/bankrolls', {
    bankrolls: { zezima: { value: 100, savedAt: 2000 }, _guest_: { value: 5, savedAt: 1000 } },
  }, token)).json() as BankrollReply;
  assert.deepEqual(first.bankrolls.zezima, { value: 100, savedAt: 2000 });

  const second = await (await postJson('/api/auth/bankrolls', {
    bankrolls: { zezima: { value: 50, savedAt: 1500 }, _guest_: { value: 9, savedAt: 3000 } },
  }, token)).json() as BankrollReply;
  assert.deepEqual(second.bankrolls, { zezima: { value: 100, savedAt: 2000 }, _guest_: { value: 9, savedAt: 3000 } });

  // A real object literal would set the prototype, so the body is built from JSON text.
  const odd = JSON.parse('{"__proto__": {"value": 7, "savedAt": 4000}, "toString": {"value": 8, "savedAt": 4000}}');
  const third = await (await postJson('/api/auth/bankrolls', { bankrolls: odd }, token)).json() as BankrollReply;
  assert.deepEqual(Object.getOwnPropertyDescriptor(third.bankrolls, '__proto__')?.value, { value: 7, savedAt: 4000 });
  assert.deepEqual(Object.getOwnPropertyDescriptor(third.bankrolls, 'toString')?.value, { value: 8, savedAt: 4000 });
});

test('bankroll entries that are empty or not amounts are skipped', async () => {
  const { token } = await (await postJson('/api/auth/register', {
    username: 'bank2', password: 'password1', question: SECURITY_QUESTIONS[0], answer: 'rex',
  })).json() as LoginReply;
  const reply = await (await postJson('/api/auth/bankrolls', {
    bankrolls: { empty: null, words: { value: 'lots', savedAt: 1 }, kept: { value: 3, savedAt: 1 } },
  }, token)).json() as BankrollReply;
  assert.deepEqual(reply.bankrolls, { kept: { value: 3, savedAt: 1 } });
});

test('callback refuses a login with no state cookie, or a token with an empty subject', async () => {
  const { state } = await startLogin();
  assert.equal(loginError(await callback(state, '', await portfolioToken('1'))), EXPIRED);
  const next = await startLogin();
  assert.equal(loginError(await callback(next.state, next.cookie, await portfolioToken(''))), REJECTED);
});

test('callback refuses a browser that sends no cookies, no form at all, or a form with no token', async () => {
  const { state } = await startLogin();
  const noCookies = await fetch(`${base}/sso/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ state, token: await portfolioToken('1') }),
  });
  assert.equal(loginError(noCookies), EXPIRED);
  const next = await startLogin();
  const noForm = await fetch(`${base}/sso/callback`, { method: 'POST', redirect: 'manual', headers: { Cookie: next.cookie } });
  assert.equal(loginError(noForm), EXPIRED);
  const last = await startLogin();
  const noToken = await fetch(`${base}/sso/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: last.cookie },
    body: new URLSearchParams({ state: last.state }),
  });
  assert.equal(loginError(noToken), REJECTED);
});

test('a login code that is not text is refused', async () => {
  assert.equal((await postJson('/api/auth/portfolio', { code: 5 })).status, 400);
  assert.equal((await postJson('/api/auth/portfolio', {})).status, 400);
});

test('a portfolio account with no name gets a made-up username', async () => {
  const { state, cookie } = await startLogin();
  const nameless = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' }).setIssuer('portfolio').setAudience('osrs-tracker').setSubject('50')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const res = await callback(state, cookie, nameless);
  const location = new URL(res.headers.get('location')!, base);
  assert.equal(location.pathname, '/link.html');
  const code = location.searchParams.get('link')!;
  assert.deepEqual(await (await postJson('/api/auth/portfolio/pending', { code })).json(), { username: '' });
  const made = await (await postJson('/api/auth/portfolio/new', { code })).json() as LoginReply;
  assert.match(made.user.username, /^player\d*$/);
});

test('portfolio login is not offered when it is not set up', async () => {
  const saved = process.env.PORTFOLIO_SSO_URL;
  delete process.env.PORTFOLIO_SSO_URL;
  try {
    assert.equal((await fetch(`${base}/sso/login`, { redirect: 'manual' })).status, 404);
  } finally {
    process.env.PORTFOLIO_SSO_URL = saved;
  }
});

test('a login code for an account removed since is refused', async () => {
  const { storagePathFor } = await import('./jsonStore.js');
  const { code } = await portfolioLogin('640');
  const made = (await (await postJson('/api/auth/portfolio/new', { code })).json()) as LoginReply;
  const again = await portfolioLogin('640');
  await fs.rm(storagePathFor(usersTmp, made.user.id));
  assert.equal((await postJson('/api/auth/portfolio', { code: again.code })).status, 401);
});

test('login codes left unused expire', async () => {
  const { code } = await portfolioLogin('30');
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60 * 1000;
  try {
    await portfolioLogin('31');
    assert.equal((await postJson('/api/auth/portfolio/pending', { code })).status, 400);
  } finally {
    Date.now = realNow;
  }
});
