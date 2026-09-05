import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const usersTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-auth-test-users-'));
process.env.USERS_DATA_DIR = usersTmp;
process.env.JWT_SECRET = 'test-jwt-secret-for-auth-suite';

const { mintApiToken, mintWildcardToken, requireBearerToken, extractBearerToken } = await import('./auth.js');
const { registerUser, loginUser, bindJagexAccountForSync } = await import('./users.js');

before(async () => {
  await registerUser('jwt-user@example.com', 'password123');
});

after(async () => {
  await fs.rm(usersTmp, { recursive: true, force: true });
  delete process.env.USERS_DATA_DIR;
  delete process.env.JWT_SECRET;
  delete process.env.LAN_MODE;
});

function fakeReq(authorization?: string) {
  return { headers: { authorization } } as Parameters<typeof requireBearerToken>[0];
}

test('mintApiToken returns a verifiable JWT', async () => {
  const user = await loginUser('jwt-user@example.com', 'password123');
  const token = await mintApiToken(user.id);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('mintWildcardToken is deterministic across mints', async () => {
  const a = await mintWildcardToken();
  const b = await mintWildcardToken();
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('requireBearerToken accepts a scoped JWT and attaches auth context', async () => {
  const user = await loginUser('jwt-user@example.com', 'password123');
  await bindJagexAccountForSync(user.id, 'TestRsn', '4242');
  const token = await mintApiToken(user.id);
  const req = fakeReq(`Bearer ${token}`);
  await requireBearerToken(req);
  assert.equal(req.auth?.scope, 'user');
  assert.equal(req.auth?.userId, user.id);
  assert.deepEqual(req.auth?.rsns, ['testrsn']);
});

test('requireBearerToken accepts a wildcard token only in LAN mode', async () => {
  const token = await mintWildcardToken();

  await assert.rejects(() => requireBearerToken(fakeReq(`Bearer ${token}`)), /Unauthorized/);

  process.env.LAN_MODE = '1';
  try {
    const req = fakeReq(`Bearer ${token}`);
    await requireBearerToken(req);
    assert.equal(req.auth?.scope, 'all');
    assert.equal(req.auth?.userId, undefined);
  } finally {
    delete process.env.LAN_MODE;
  }
});

test('requireBearerToken rejects a garbage / non-JWT token', async () => {
  await assert.rejects(() => requireBearerToken(fakeReq('Bearer not-a-jwt')), /Unauthorized/);
  await assert.rejects(() => requireBearerToken(fakeReq('Bearer a.b.c')), /Unauthorized/);
  await assert.rejects(() => requireBearerToken(fakeReq(undefined)), /Unauthorized/);
});

test('requireBearerToken rejects any token when JWT_SECRET is unset', async () => {
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const req = fakeReq('Bearer eyJhbGciOiJIUzI1NiJ9.abc.def');
    await assert.rejects(() => requireBearerToken(req), /Unauthorized/);
  } finally {
    process.env.JWT_SECRET = saved;
  }
});

test('extractBearerToken parses Authorization header', () => {
  const req = fakeReq('Bearer abc.def.ghi');
  assert.equal(extractBearerToken(req), 'abc.def.ghi');
});
