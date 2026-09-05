import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const usersTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-users-test-'));
process.env.USERS_DATA_DIR = usersTmp;
process.env.JWT_SECRET = 'users-test-secret';

const { registerUser, loginUser, bindJagexAccountForSync, getUserById } = await import('./users.js');

after(async () => {
  await fs.rm(usersTmp, { recursive: true, force: true });
  delete process.env.USERS_DATA_DIR;
  delete process.env.JWT_SECRET;
});

test('register and login round-trip', async () => {
  const created = await registerUser('player@example.com', 'longpassword');
  assert.ok(created.id);
  assert.equal(created.email, 'player@example.com');
  assert.deepEqual(created.rsns, []);

  const loggedIn = await loginUser('player@example.com', 'longpassword');
  assert.equal(loggedIn.id, created.id);
});

test('bindJagexAccountForSync auto-claims the RSN and hash, then alts on the same hash', async () => {
  const user = await registerUser('binder@example.com', 'longpassword');
  const first = await bindJagexAccountForSync(user.id, 'Zezima', '111');
  assert.deepEqual(first.rsns, ['zezima']);
  assert.equal(first.accountHash, '111');

  const alt = await bindJagexAccountForSync(user.id, 'AltOne', '111');
  assert.deepEqual(alt.rsns, ['zezima', 'altone']);
  assert.equal(alt.accountHash, '111');

  const other = await registerUser('otherbind@example.com', 'longpassword');
  await assert.rejects(() => bindJagexAccountForSync(other.id, 'Zezima', '222'), /claimed by another account/);
  await assert.rejects(() => bindJagexAccountForSync(other.id, 'NewAlt', '111'), /bound to another login/);
  await assert.rejects(
    () => bindJagexAccountForSync(user.id, 'Third', '999'),
    /different Jagex account/,
  );
});

test('getUserById returns null for missing users', async () => {
  assert.equal(await getUserById('missing-id'), null);
});

// The email becomes a filename, so it gets the same traversal treatment
// storageKey() gives usernames. `a@x.co/../../sync/<name>` is address-shaped to
// any regex that only looks for "something @ something . something", and once
// wrote {"userId":...} straight over a player's synced data file.
test('registerUser rejects an email that would escape the users directory', async () => {
  const decoyDir = path.join(usersTmp, '..', 'sync-decoy');
  await fs.mkdir(decoyDir, { recursive: true });
  const decoy = path.join(decoyDir, 'victim.json');
  await fs.writeFile(decoy, '{"username":"victim","syncedAt":"real"}', 'utf8');

  await assert.rejects(
    () => registerUser('a@x.co/../../sync-decoy/victim', 'longpassword'),
    /Invalid email/,
  );
  assert.equal(await fs.readFile(decoy, 'utf8'), '{"username":"victim","syncedAt":"real"}');

  await fs.rm(decoyDir, { recursive: true, force: true });
});

test('registerUser rejects separators and dot-segments anywhere in the address', async () => {
  for (const email of [
    'a/b@example.com',
    'a\\b@example.com',
    'user@exam/ple.com',
    'user@example.com/../x.co',
    '..@example.com',
    'user@..example.com',
  ]) {
    await assert.rejects(() => registerUser(email, 'longpassword'), /Invalid email/, email);
  }
});

test('loginUser rejects a malformed address with the same 401 as a wrong password', async () => {
  await assert.rejects(
    () => loginUser('a@x.co/../../sync-decoy/victim', 'longpassword'),
    (err: unknown) => {
      assert.equal((err as { statusCode?: number }).statusCode, 401);
      assert.match((err as Error).message, /Invalid email or password/);
      return true;
    },
  );
});

test('the email index is stored under a hash, not the address itself', async () => {
  await registerUser('Indexed@Example.com', 'longpassword');
  const digest = createHash('sha256').update('indexed@example.com').digest('hex');

  const entries = await fs.readdir(path.join(usersTmp, 'by-email'));
  assert.ok(entries.includes(`${digest}.json`));
  assert.ok(!entries.some((name) => name.includes('@')), 'no address is written as a filename');
});

// A pre-hash install has `<address>.json` on disk; that account has to keep
// working, so the first lookup moves it onto the hashed path.
test('a legacy plaintext index file is honoured once, then migrated', async () => {
  const user = await registerUser('legacy@example.com', 'longpassword');
  const digest = createHash('sha256').update('legacy@example.com').digest('hex');
  const byEmail = path.join(usersTmp, 'by-email');

  // Put the tree back the way the old code would have left it.
  await fs.rm(path.join(byEmail, `${digest}.json`));
  await fs.writeFile(path.join(byEmail, 'legacy@example.com.json'), JSON.stringify({ userId: user.id }), 'utf8');

  const loggedIn = await loginUser('legacy@example.com', 'longpassword');
  assert.equal(loggedIn.id, user.id);

  const entries = await fs.readdir(byEmail);
  assert.ok(entries.includes(`${digest}.json`), 'migrated onto the hashed path');
  assert.ok(!entries.includes('legacy@example.com.json'), 'plaintext index removed');
});

// Registration is two writes. If it dies between them the email is held by an
// id that resolves to nothing; that must be re-claimable, not a permanent
// lockout on the address.
test('an index entry pointing at a missing account does not block registration', async () => {
  const user = await registerUser('halfway@example.com', 'longpassword');
  await fs.rm(path.join(usersTmp, `${user.id}.json`));

  const retried = await registerUser('halfway@example.com', 'differentpassword');
  assert.notEqual(retried.id, user.id);

  const loggedIn = await loginUser('halfway@example.com', 'differentpassword');
  assert.equal(loggedIn.id, retried.id);
});

test('a live account still blocks a second registration on the same email', async () => {
  await registerUser('taken@example.com', 'longpassword');
  await assert.rejects(() => registerUser('taken@example.com', 'longpassword'), /already registered/);
});

// The stored format now carries its own cost parameters. Records written
// before it did must keep working, or every existing password breaks.
test('a password hashed in the pre-parameters format still verifies', async () => {
  const { scrypt } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scryptAsync = promisify(scrypt) as (p: string, s: string, l: number) => Promise<Buffer>;

  const user = await registerUser('legacyhash@example.com', 'longpassword');
  const legacy = `scrypt:fixed-salt:${(await scryptAsync('longpassword', 'fixed-salt', 64)).toString('base64')}`;
  const record = JSON.parse(await fs.readFile(path.join(usersTmp, `${user.id}.json`), 'utf8'));
  await fs.writeFile(
    path.join(usersTmp, `${user.id}.json`),
    JSON.stringify({ ...record, passwordHash: legacy }),
    'utf8',
  );

  const loggedIn = await loginUser('legacyhash@example.com', 'longpassword');
  assert.equal(loggedIn.id, user.id);
  await assert.rejects(() => loginUser('legacyhash@example.com', 'wrongpassword'), /Invalid email or password/);
});

test('a new hash records its scrypt cost parameters', async () => {
  const user = await registerUser('params@example.com', 'longpassword');
  const record = JSON.parse(await fs.readFile(path.join(usersTmp, `${user.id}.json`), 'utf8'));
  assert.match(record.passwordHash, /^scrypt:16384:8:1:[^:]+:.+$/);
  assert.equal((await loginUser('params@example.com', 'longpassword')).id, user.id);
});
