import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-ronovo-test-'));
const usersTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-ronovo-users-'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.SYNC_DATA_DIR = tmpDir;
process.env.USERS_DATA_DIR = usersTmp;
process.env.RATE_LIMIT_MAX = '0';
process.env.JWT_SECRET = 'ronovo-test-secret';
process.env.RONOVO_SSO_URL = 'http://ronovo.test';
process.env.RONOVO_SSO_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
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
  for (const key of ['JWT_SECRET', 'RONOVO_SSO_URL', 'RONOVO_SSO_PUBLIC_KEY']) delete process.env[key];
});

function ronovoToken(sub: string, { aud = 'osrs-tracker', expiresIn = '5m' } = {}): Promise<string> {
  return new SignJWT({ name: `player${sub}` })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('ronovo')
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
  assert.equal(location.origin + location.pathname, 'http://ronovo.test/sso/authorize');
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

async function ronovoCode(sub: string): Promise<string> {
  const { state, cookie } = await startLogin();
  const res = await callback(state, cookie, await ronovoToken(sub));
  assert.equal(res.status, 302);
  return new URL(res.headers.get('location')!, base).searchParams.get('ronovo')!;
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

test('status offers Ronovo login and the portfolio address when it is configured', async () => {
  const res = await fetch(`${base}/api/auth/status`);
  assert.deepEqual(await res.json(), { mode: 'public', accounts: true, ronovo: true, ronovoUrl: 'http://ronovo.test' });
  assert.ok(res.headers.get('content-security-policy')?.includes("connect-src 'self' http://ronovo.test;"));
});

test('callback rejects a wrong state, another app\'s token and an expired token', async () => {
  const first = await startLogin();
  assert.equal((await callback('wrong', first.cookie, await ronovoToken('1'))).status, 400);
  const second = await startLogin();
  assert.equal((await callback(second.state, second.cookie, await ronovoToken('1', { aud: 'casino' }))).status, 400);
  const third = await startLogin();
  assert.equal((await callback(third.state, third.cookie, await ronovoToken('1', { expiresIn: '-10s' }))).status, 400);
});

test('the first Ronovo login makes an account that every device shares', async () => {
  const code = await ronovoCode('10');
  const first = await (await postJson('/api/auth/ronovo', { code })).json() as LoginReply;
  assert.equal(first.user.username, 'player10');
  assert.ok(first.token);
  assert.equal((await postJson('/api/auth/ronovo', { code })).status, 400, 'a used code is gone');

  const second = await (await postJson('/api/auth/ronovo', { code: await ronovoCode('10') })).json() as LoginReply;
  assert.equal(second.user.id, first.user.id);
});

test('a made-up code is refused', async () => {
  assert.equal((await postJson('/api/auth/ronovo', { code: 'made-up' })).status, 400);
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
