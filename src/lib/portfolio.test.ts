import { test, after } from 'node:test';
import assert from 'node:assert/strict';
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

test('callback rejects a wrong state, another app\'s token and an expired token', async () => {
  const first = await startLogin();
  assert.equal((await callback('wrong', first.cookie, await portfolioToken('1'))).status, 400);
  const second = await startLogin();
  assert.equal((await callback(second.state, second.cookie, await portfolioToken('1', { aud: 'casino' }))).status, 400);
  const third = await startLogin();
  assert.equal((await callback(third.state, third.cookie, await portfolioToken('1', { expiresIn: '-10s' }))).status, 400);
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
    username: 'linker', password: 'password1', question: "What is your mother's maiden name?", answer: 'rex',
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
    username: 'bank', password: 'password1', question: "What is your mother's maiden name?", answer: 'rex',
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
});
