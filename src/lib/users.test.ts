import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const usersTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-users-test-'));
process.env.USERS_DATA_DIR = usersTmp;
process.env.JWT_SECRET = 'users-test-secret';

const {
  registerUser, loginUser, bindJagexAccountForSync, getUserById, portfolioUser, resetPassword, securityQuestionFor,
} = await import('./users.js');
const { SECURITY_QUESTIONS } = await import('../shared/securityQuestions.js');

const QUESTION = SECURITY_QUESTIONS[1]!;

function register(username: string, password = 'longpassword') {
  return registerUser(username, password, QUESTION, 'Rex');
}

after(async () => {
  await fs.rm(usersTmp, { recursive: true, force: true });
  delete process.env.USERS_DATA_DIR;
  delete process.env.JWT_SECRET;
});

test('register and login round-trip', async () => {
  const created = await register('player');
  assert.ok(created.id);
  assert.equal(created.username, 'player');
  assert.deepEqual(created.rsns, []);

  const loggedIn = await loginUser('PLAYER', 'longpassword');
  assert.equal(loggedIn.id, created.id);
});

test('bindJagexAccountForSync auto-claims the RSN and hash, then alts on the same hash', async () => {
  const user = await register('binder');
  const first = await bindJagexAccountForSync(user.id, 'Zezima', '111');
  assert.deepEqual(first.rsns, ['zezima']);
  assert.equal(first.accountHash, '111');

  const alt = await bindJagexAccountForSync(user.id, 'AltOne', '111');
  assert.deepEqual(alt.rsns, ['zezima', 'altone']);
  assert.equal(alt.accountHash, '111');

  const other = await register('otherbind');
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

test('registerUser only takes plain usernames', async () => {
  for (const username of ['ab', 'a'.repeat(21), 'has space', '../../sync/victim', 'a/b', 'me@example.com']) {
    await assert.rejects(() => register(username), /Usernames are 3-20/, username);
  }
});

test('registerUser needs a listed security question and an answer', async () => {
  await assert.rejects(() => registerUser('noquestion', 'longpassword', 'Favorite color?', 'blue'), /Pick a security question/);
  await assert.rejects(() => registerUser('noanswer', 'longpassword', QUESTION, '   '), /Answer your security question/);
});

test('the username index is stored under a hash, not the name itself', async () => {
  await register('Indexed');
  const digest = createHash('sha256').update('indexed').digest('hex');
  const entries = await fs.readdir(path.join(usersTmp, 'by-username'));
  assert.ok(entries.includes(`${digest}.json`));
  assert.ok(!entries.includes('Indexed.json'));
});

// Usernames are hashed into the index path, so a login attempt can't read
// outside the users directory.
test('loginUser rejects path-shaped names with the same 401 as a wrong password', async () => {
  await assert.rejects(
    () => loginUser('a@x.co/../../sync-decoy/victim', 'longpassword'),
    (err: unknown) => {
      assert.equal((err as { statusCode?: number }).statusCode, 401);
      assert.match((err as Error).message, /Invalid username or password/);
      return true;
    },
  );
});

// Registration is two writes. If it dies between them the name is held by an
// id that resolves to nothing; that must be re-claimable, not a permanent lockout.
test('an index entry pointing at a missing account does not block registration', async () => {
  const user = await register('halfway');
  await fs.rm(path.join(usersTmp, `${user.id}.json`));

  const retried = await register('halfway', 'differentpassword');
  assert.notEqual(retried.id, user.id);
  assert.equal((await loginUser('halfway', 'differentpassword')).id, retried.id);
});

test('a live account still blocks a second registration on the same name', async () => {
  await register('taken');
  await assert.rejects(() => register('TAKEN'), /That username is taken/);
});

test('a new hash records its scrypt cost parameters', async () => {
  const user = await register('params');
  const record = JSON.parse(await fs.readFile(path.join(usersTmp, `${user.id}.json`), 'utf8'));
  assert.match(record.passwordHash, /^scrypt:16384:8:1:[^:]+:.+$/);
  assert.equal((await loginUser('params', 'longpassword')).id, user.id);
});

test('the right security answer resets the password and stamps the change', async () => {
  const user = await register('forgetful');
  assert.equal(await securityQuestionFor('Forgetful'), QUESTION);
  await assert.rejects(() => resetPassword('forgetful', 'cat', 'newpassword'), /That answer is wrong/);
  await resetPassword('forgetful', '  REX ', 'newpassword');
  assert.equal((await loginUser('forgetful', 'newpassword')).id, user.id);
  assert.equal((await getUserById(user.id))!.tokenVersion, 1);
});

test('wrong answers lock resets for a while', async () => {
  await register('locked');
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => resetPassword('locked', 'cat', 'newpassword'), /That answer is wrong/);
  }
  await assert.rejects(() => resetPassword('locked', 'rex', 'newpassword'), /Too many wrong answers/);
});

test('an unknown username gets a steady stand-in question and cannot be reset', async () => {
  const question = await securityQuestionFor('ghost');
  assert.ok(SECURITY_QUESTIONS.includes(question));
  assert.equal(await securityQuestionFor('GHOST'), question);
  await assert.rejects(() => resetPassword('ghost', 'anything', 'newpassword'), /That answer is wrong/);
});

test('a new portfolio account login makes one account, named after it, that has no reset', async () => {
  const first = await portfolioUser('42', 'ronovo');
  assert.equal(first.username, 'ronovo');
  assert.equal((await portfolioUser('42', 'ronovo')).id, first.id);
  await register('taken2');
  assert.equal((await portfolioUser('43', 'taken2')).username, 'taken22');
  await assert.rejects(() => resetPassword('ronovo', '', 'newpassword'), /That answer is wrong/);
});
