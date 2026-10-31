import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';

const syncTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-account-errors-sync-'));
const usersTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-account-errors-users-'));
process.env.SYNC_DATA_DIR = syncTmp;
process.env.USERS_DATA_DIR = usersTmp;
process.env.RATE_LIMIT_MAX = '0';
process.env.JWT_SECRET = 'account-errors-secret';
delete process.env.LAN_MODE;
delete process.env.PORTFOLIO_SSO_URL;
delete process.env.PORTFOLIO_SSO_PUBLIC_KEY;

const { createApp } = await import('./app.js');
const users = await import('./users.js');
const auth = await import('./auth.js');

const server = createApp().listen(0);
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const QUESTION = "What is your mother's maiden name?";

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await fs.rm(syncTmp, { recursive: true, force: true });
  await fs.rm(usersTmp, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
});

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function post(route: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; error?: string }> {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json()) as { error?: string } };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function apiToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ typ: 'api', ...claims }).setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

async function register(username: string): Promise<{ id: string; token: string }> {
  const user = await users.registerUser(username, 'correct horse', QUESTION, 'smith');
  return { id: user.id, token: await auth.mintApiToken(user.id) };
}

test('account requests that are not JSON are refused', async () => {
  const res = await fetch(`${base}/api/auth/reset-question`, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: 'username=zezima' });
  assert.deepEqual({ status: res.status, ...(await res.json() as object) }, { status: 400, error: 'Invalid JSON body' });
});

test('bankrolls must be an object of named buckets, and not too many', async () => {
  const { token } = await register('bank-checks');
  for (const bankrolls of [undefined, [], 'lots']) {
    assert.deepEqual(await post('/api/auth/bankrolls', { bankrolls }, bearer(token)),
      { status: 400, error: 'Invalid JSON body' });
  }
  const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, { value: 1, savedAt: 1 }]));
  assert.deepEqual(await post('/api/auth/bankrolls', { bankrolls: many }, bearer(token)),
    { status: 400, error: 'Too many bankrolls' });
});

test('password resets are off in LAN mode and without accounts', async () => {
  for (const env of [{ LAN_MODE: '1' }, { JWT_SECRET: undefined }]) {
    await withEnv(env, async () => {
      for (const route of ['/api/auth/reset-question', '/api/auth/reset-password']) {
        assert.deepEqual(await post(route, { username: 'x' }),
          { status: 501, error: 'Account auth is not enabled on this server' });
      }
    });
  }
});

test('a reset needs a username, and an answer of a sensible length', async () => {
  for (const username of [undefined, '   ', 'x'.repeat(21)]) {
    assert.deepEqual(await post('/api/auth/reset-question', { username }), { status: 400, error: 'Enter your username' });
  }
  for (const answer of [undefined, 'x'.repeat(201)]) {
    assert.deepEqual(await post('/api/auth/reset-password', { username: 'anyone', password: 'new password', answer }),
      { status: 400, error: 'That answer is wrong' });
  }
});

test('a security answer over the length limit is refused', async () => {
  await assert.rejects(users.registerUser('long-answer', 'correct horse', QUESTION, 'x'.repeat(201)),
    { statusCode: 400, message: /^Keep the security answer to \d+ characters or fewer$/ });
});

test('a stored password hash that cannot be read never logs in', async () => {
  const { id } = await register('broken-hash');
  const file = path.join(usersTmp, (await fs.readdir(usersTmp, { recursive: true }))
    .find((name) => String(name).endsWith(`${id}.json`))!);
  for (const hash of ['plaintext', 'scrypt:1:2:3', 'scrypt:x:8:1:salt:aGFzaA==']) {
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...record, passwordHash: hash }));
    await assert.rejects(users.loginUser('broken-hash', 'correct horse'), { statusCode: 401 });
  }
});

test('account features are off without a JWT secret', async () => {
  await withEnv({ JWT_SECRET: undefined }, async () => {
    for (const attempt of [users.loginUser('anyone', 'password1'), users.bindJagexAccountForSync('id', 'zezima', '1'),
      auth.mintApiToken('id')]) {
      await assert.rejects(attempt, { statusCode: 501, message: 'Account auth is not enabled on this server' });
    }
    await assert.rejects(auth.mintWildcardToken(), { statusCode: 501, message: 'JWT_SECRET is not set' });
  });
});

test('changes for an account that no longer exists are refused', async () => {
  await assert.rejects(users.mergeBankrolls('no-such-account', {}), { statusCode: 401 });
});

test('an account token must name a live account at its current version', async () => {
  const { id } = await register('token-checks');
  for (const claims of [{ scope: 'user' }, { scope: 'user', sub: 'no-such-account' }, { scope: 'user', sub: id, ver: 3 }]) {
    const res = await fetch(`${base}/api/auth/me`, { headers: bearer(await apiToken(claims)) });
    assert.equal(res.status, 401, JSON.stringify(claims));
  }
});

test('the account endpoint wants an account token, not the LAN token', async () => {
  await withEnv({ LAN_MODE: '1' }, async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: bearer(await auth.mintWildcardToken()) });
    assert.equal(res.status, 401);
  });
});

test('a sync that changes nothing writes nothing', async () => {
  const { id } = await register('quiet-sync');
  await users.bindJagexAccountForSync(id, 'zezima', '42');
  const again = await users.bindJagexAccountForSync(id, 'zezima', '42');
  assert.deepEqual(again.rsns, ['zezima']);
  assert.equal(again.accountHash, '42');
});

test('a portfolio account id is checked before it is used', async () => {
  assert.equal(await users.getUserByPortfolioSub('../escape'), null);
  const { id } = await register('portfolio-checks');
  await assert.rejects(async () => users.linkPortfolio(id, '../escape'),
    { statusCode: 400, message: 'Invalid portfolio account' });
});

test('an account linked to one portfolio account cannot link another', async () => {
  const { id } = await register('linked-once');
  await users.linkPortfolio(id, 'sub-1');
  await assert.rejects(users.linkPortfolio(id, 'sub-2'),
    { statusCode: 409, message: 'That account is already linked to another portfolio account' });
});
