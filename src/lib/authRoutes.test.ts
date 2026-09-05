import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-authroutes-test-'));
const usersTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-authroutes-users-'));
process.env.SYNC_DATA_DIR = tmpDir;
process.env.USERS_DATA_DIR = usersTmp;
process.env.RATE_LIMIT_MAX = '0';
delete process.env.JWT_SECRET;
delete process.env.LAN_MODE;

const { createApp } = await import('./app.js');
const { jwtVerify } = await import('jose');

const app = createApp();
const server = app.listen(0);
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(usersTmp, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
  delete process.env.LAN_MODE;
});

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('guest posture: status reports guest and no LAN token', async () => {
  await withEnv({ JWT_SECRET: undefined, LAN_MODE: undefined }, async () => {
    const res = await fetch(`${base}/api/auth/status`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { mode: 'guest', accounts: false });
  });
});

test('public posture: status reports accounts, /api/auth/token needs auth', async () => {
  await withEnv({ JWT_SECRET: 'authroutes-secret', LAN_MODE: undefined }, async () => {
    const status = await (await fetch(`${base}/api/auth/status`)).json();
    assert.deepEqual(status, { mode: 'public', accounts: true });

    const mint = await fetch(`${base}/api/auth/token`, { method: 'POST' });
    assert.equal(mint.status, 401);
  });
});

test('public posture: over-long password is rejected 400 before hashing', async () => {
  await withEnv({ JWT_SECRET: 'authroutes-secret', LAN_MODE: undefined }, async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'lengthcap@example.com', password: 'x'.repeat(201) }),
    });
    assert.equal(res.status, 400);
  });
});

test('auth endpoints throttle repeated attempts on the same email (429)', async () => {
  await withEnv({ JWT_SECRET: 'authroutes-secret', LAN_MODE: undefined }, async () => {
    const email = `bruteforce-${Date.now()}@example.com`;
    const attempt = () => fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password' }),
    });

    // AUTH_RATE_LIMIT_MAX defaults to 10/min; the 11th hit on this bucket trips.
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await attempt()).status);

    assert.ok(codes.slice(0, 10).every((c) => c === 401), `expected ten 401s, got ${codes}`);
    assert.equal(codes[10], 429);
  });
});

test('LAN posture: status carries a wildcard token, /api/auth/token returns it unauthenticated', async () => {
  await withEnv({ JWT_SECRET: 'authroutes-secret', LAN_MODE: '1' }, async () => {
    const status = (await (await fetch(`${base}/api/auth/status`)).json()) as {
      mode: string;
      accounts: boolean;
      lanToken?: string;
    };
    assert.equal(status.mode, 'lan');
    assert.equal(status.accounts, false);
    assert.ok(status.lanToken);

    const { payload } = await jwtVerify(
      status.lanToken!,
      new TextEncoder().encode('authroutes-secret'),
      { algorithms: ['HS256'] },
    );
    assert.equal(payload.scope, 'all');
    assert.equal(payload.exp, undefined);

    const minted = (await (await fetch(`${base}/api/auth/token`, { method: 'POST' })).json()) as { token: string };
    assert.equal(minted.token, status.lanToken);

    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'password123' }),
    });
    assert.equal(reg.status, 403);
  });
});

// The unauthorised arms of the account endpoints, which the posture tests
// above never reach because they stop at the status route.
test('public posture: /api/auth/me needs a scoped token', async () => {
  await withEnv({ JWT_SECRET: 'me-secret-'.repeat(4), LAN_MODE: undefined }, async () => {
    const noHeader = await fetch(`${base}/api/auth/me`);
    assert.equal(noHeader.status, 401);
    assert.match(noHeader.headers.get('content-type') ?? '', /application\/json/);

    const garbage = await fetch(`${base}/api/auth/me`, { headers: { Authorization: 'Bearer nonsense' } });
    assert.equal(garbage.status, 401);

    // A wildcard token is validly signed but carries no account, so it cannot
    // answer "who am I" even where it would be honoured for sync.
    const { mintWildcardToken } = await import('./auth.js');
    const wildcard = await mintWildcardToken();
    const asWildcard = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${wildcard}` } });
    assert.equal(asWildcard.status, 401);
  });
});

test('public posture: register then /api/auth/me round-trips the account', async () => {
  await withEnv({ JWT_SECRET: 'roundtrip-secret-'.repeat(3), LAN_MODE: undefined }, async () => {
    const created = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'round@example.com', password: 'longpassword' }),
    });
    assert.equal(created.status, 201);
    const { token, user } = await created.json() as { token: string; user: { email: string } };
    assert.equal(user.email, 'round@example.com');

    const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    const body = await me.json() as { email: string; rsns: string[] };
    assert.equal(body.email, 'round@example.com');
    assert.deepEqual(body.rsns, [], 'a fresh account has claimed nothing');

    // Minting a plugin token needs that same account token, and yields a
    // working one.
    const minted = await fetch(`${base}/api/auth/token`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(minted.status, 200);
    const { token: plugin } = await minted.json() as { token: string };
    const reused = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${plugin}` } });
    assert.equal(reused.status, 200);
  });
});

test('public posture: registration rejects a bad email, a short password and a duplicate', async () => {
  await withEnv({ JWT_SECRET: 'validate-secret-'.repeat(3), LAN_MODE: undefined }, async () => {
    const post = (body: unknown) => fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    assert.equal((await post({ email: 'not-an-email', password: 'longpassword' })).status, 400);
    assert.equal((await post({ email: 'short@example.com', password: 'abc' })).status, 400);
    assert.equal((await post({ email: 'dupe@example.com', password: 'longpassword' })).status, 201);
    assert.equal((await post({ email: 'dupe@example.com', password: 'longpassword' })).status, 409);
    // Missing fields entirely, rather than invalid ones.
    assert.equal((await post({ email: 'nopass@example.com' })).status, 400);
    assert.equal((await post('a string, not an object')).status, 400);
  });
});

test('guest posture: the account endpoints report that accounts are off', async () => {
  await withEnv({ JWT_SECRET: undefined, LAN_MODE: undefined }, async () => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'guest@example.com', password: 'longpassword' }),
    });
    assert.equal(res.status, 501);
    assert.match((await res.json() as { error: string }).error, /not enabled/);
  });
});

test('LAN posture: registration and sign-in are refused outright', async () => {
  await withEnv({ JWT_SECRET: 'lan-secret-'.repeat(4), LAN_MODE: '1' }, async () => {
    for (const route of ['register', 'login']) {
      const res = await fetch(`${base}/api/auth/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'lan@example.com', password: 'longpassword' }),
      });
      assert.equal(res.status, 403, route);
      assert.match((await res.json() as { error: string }).error, /LAN mode/);
    }
  });
});
