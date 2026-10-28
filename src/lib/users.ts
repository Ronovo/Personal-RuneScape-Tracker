import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { ScryptOptions } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteFile } from './atomicWrite.js';
import { httpError } from './errors.js';
import { storageKey } from './sync.js';
import { readJsonOrDefault, storagePathFor } from './jsonStore.js';
import fs from 'fs/promises';
import { MAX_SECURITY_ANSWER, SECURITY_QUESTIONS, normalizeAnswer } from '../shared/securityQuestions.js';

// promisify() picks the no-options overload, which drops the cost parameters
// this module now passes explicitly.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNT_HASH_RE = /^-?[0-9]{1,19}$/;

function usersDir(): string {
  return process.env.USERS_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'users');
}

export interface UserRecord {
  id: string;
  username: string;
  // Accounts made before usernames hold the address they registered with here
  // instead, and that address is now their username (see getUserById).
  email?: string;
  passwordHash: string;
  securityQuestion?: string;
  securityAnswerHash?: string;
  resetFailures?: number;
  resetLockedUntil?: number;
  // Bumped by a password reset. API tokens carry the version they were issued under.
  tokenVersion?: number;
  rsns: string[];
  accountHash?: string;
  ronovoSub?: string;
  bankrolls?: Record<string, SavedBankroll>;
  createdAt: string;
}

export interface SavedBankroll {
  value: number;
  savedAt: number;
}

function userPath(userId: string): string {
  return storagePathFor(usersDir(), userId);
}

// The username is hashed rather than used as a filename directly, so nothing a
// user types can act as a path segment.
function usernameIndexPath(username: string): string {
  const digest = createHash('sha256').update(normalizeUsername(username)).digest('hex');
  return path.join(usersDir(), 'by-username', `${digest}.json`);
}

// Accounts made before usernames are indexed here by the hashed address they
// registered with, which is normalized the same way a username is.
// findUserIdByUsername() moves a hit onto by-username.
function emailIndexPath(email: string): string {
  const digest = createHash('sha256').update(normalizeUsername(email)).digest('hex');
  return path.join(usersDir(), 'by-email', `${digest}.json`);
}

// Pre-hash installs wrote `<address>.json` here. Read-only, and only ever built
// from an address that passes isLegacyEmail(), so it cannot traverse. Safe to
// delete once no deployment still holds a plaintext index file.
function legacyEmailIndexPath(email: string): string {
  return path.join(usersDir(), 'by-email', `${normalizeUsername(email)}.json`);
}

function rsnClaimPath(rsn: string): string {
  return path.join(usersDir(), 'rsn-claims', `${rsn}.json`);
}

function ronovoClaimPath(sub: string): string {
  return path.join(usersDir(), 'ronovo-claims', `${sub}.json`);
}

function hashClaimPath(accountHash: string): string {
  return path.join(usersDir(), 'hash-claims', `${accountHash}.json`);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

// Shape check, plus an explicit ban on anything that could act as a path
// segment. The shape regex alone accepts `/`, `\` and `..`.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PATH_UNSAFE_RE = /[/\\]|\.\./;

function isLegacyEmail(value: string): boolean {
  const normalized = normalizeUsername(value);
  return EMAIL_SHAPE_RE.test(normalized) && !PATH_UNSAFE_RE.test(normalized);
}

// Node's own scrypt defaults, written into the hash rather than assumed. The
// original format was `scrypt:<salt>:<hash>`, which left nowhere to record the
// cost - so raising N later would have invalidated every existing password
// instead of just the ones not yet re-hashed. Records written in that format
// still verify, under the defaults they were made with.
const SCRYPT_KEY_LEN = 64;
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1 } as const;

interface StoredHash {
  params: { N: number; r: number; p: number };
  salt: string;
  hashB64: string;
}

function parseStoredHash(stored: string): StoredHash | null {
  const parts = stored.split(':');
  // A salt is a UUID, so no part can contain a colon of its own.
  if (parts[0] !== 'scrypt') return null;

  if (parts.length === 6) {
    const [, n, r, p, salt, hashB64] = parts;
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (!salt || !hashB64 || !Object.values(params).every(Number.isInteger)) return null;
    return { params, salt, hashB64 };
  }
  if (parts.length === 3) {
    const [, salt, hashB64] = parts;
    if (!salt || !hashB64) return null;
    return { params: { ...SCRYPT_PARAMS }, salt, hashB64 };
  }
  return null;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomUUID();
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LEN, { ...SCRYPT_PARAMS });
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt:${N}:${r}:${p}:${salt}:${derived.toString('base64')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return false;
  }
  const derived = await scryptAsync(password, parsed.salt, SCRYPT_KEY_LEN, parsed.params);
  const expected = Buffer.from(parsed.hashB64, 'base64');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

async function ensureUserDirs(): Promise<void> {
  const root = usersDir();
  await fs.mkdir(path.join(root, 'by-username'), { recursive: true });
  await fs.mkdir(path.join(root, 'rsn-claims'), { recursive: true });
  await fs.mkdir(path.join(root, 'hash-claims'), { recursive: true });
  await fs.mkdir(path.join(root, 'ronovo-claims'), { recursive: true });
}

export function parseAccountHash(value: unknown): string {
  if (typeof value !== 'string' || !ACCOUNT_HASH_RE.test(value) || value === '-1') {
    throw httpError('Missing or invalid accountHash', 400);
  }
  return value;
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const user = await readJsonOrDefault<UserRecord | null>(userPath(userId), null);
  return user && { ...user, username: user.username ?? user.email ?? '' };
}

async function findUserIdByUsername(username: string): Promise<string | null> {
  const index = await readJsonOrDefault<{ userId?: string } | null>(usernameIndexPath(username), null);
  if (index?.userId) {
    return index.userId;
  }

  // Fall back to an index from before usernames and move it onto by-username,
  // so an existing account keeps working across the upgrade without a migration step.
  let oldPath = emailIndexPath(username);
  let old = await readJsonOrDefault<{ userId?: string } | null>(oldPath, null);
  if (!old?.userId && isLegacyEmail(username)) {
    oldPath = legacyEmailIndexPath(username);
    old = await readJsonOrDefault<{ userId?: string } | null>(oldPath, null);
  }
  if (!old?.userId) {
    return null;
  }
  await ensureUserDirs();
  await atomicWriteFile(usernameIndexPath(username), JSON.stringify({ userId: old.userId }));
  await fs.rm(oldPath, { force: true });
  return old.userId;
}

function checkPassword(password: string): void {
  if (!password || password.length < 8) {
    throw httpError('Password must be at least 8 characters', 400);
  }
}

function checkSecurityAnswer(question: unknown, answer: unknown): void {
  if (typeof question !== 'string' || !SECURITY_QUESTIONS.includes(question)) {
    throw httpError('Pick a security question', 400);
  }
  const normalized = typeof answer === 'string' ? normalizeAnswer(answer) : '';
  if (!normalized) {
    throw httpError('Answer your security question', 400);
  }
  if (normalized.length > MAX_SECURITY_ANSWER) {
    throw httpError(`Keep the security answer to ${MAX_SECURITY_ANSWER} characters or fewer`, 400);
  }
}

// Writes a new account under a username that is free. Index first, record
// second: the index is the uniqueness claim, so a half-finished registration
// fails closed - the name is held by an id that resolves to nothing, which logs
// in as "invalid username or password" and is re-claimable by the next attempt.
// The other order would leave an orphan account with its name still free.
async function createUser(fields: Omit<UserRecord, 'id' | 'rsns' | 'createdAt'>): Promise<UserRecord | null> {
  await ensureUserDirs();
  const existingId = await findUserIdByUsername(fields.username);
  if (existingId && (await getUserById(existingId))) {
    return null;
  }
  const user: UserRecord = { id: randomUUID(), rsns: [], createdAt: new Date().toISOString(), ...fields };
  await atomicWriteFile(usernameIndexPath(user.username), JSON.stringify({ userId: user.id }));
  await atomicWriteFile(userPath(user.id), JSON.stringify(user, null, 2));
  return user;
}

export async function registerUser(username: string, password: string, question: unknown, answer: unknown): Promise<UserRecord> {
  if (!jwtUsersEnabled()) {
    throw httpError('Account auth is not enabled on this server', 501);
  }
  if (!USERNAME_RE.test(username)) {
    throw httpError('Usernames are 3-20 letters, numbers, _ or -', 400);
  }
  checkPassword(password);
  checkSecurityAnswer(question, answer);
  const user = await createUser({
    username,
    passwordHash: await hashPassword(password),
    securityQuestion: question as string,
    securityAnswerHash: await hashPassword(normalizeAnswer(answer as string)),
  });
  if (!user) {
    throw httpError('That username is taken', 409);
  }
  return user;
}

export async function loginUser(username: string, password: string): Promise<UserRecord> {
  if (!jwtUsersEnabled()) {
    throw httpError('Account auth is not enabled on this server', 501);
  }
  const userId = await findUserIdByUsername(username);
  const user = userId ? await getUserById(userId) : null;
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw httpError('Invalid username or password', 401);
  }
  return user;
}

async function saveUser(user: UserRecord): Promise<void> {
  await atomicWriteFile(userPath(user.id), JSON.stringify(user, null, 2));
}

export async function setSecurityQuestion(userId: string, question: unknown, answer: unknown): Promise<void> {
  checkSecurityAnswer(question, answer);
  const user = await getUserById(userId);
  if (!user) {
    throw httpError('Unauthorized', 401);
  }
  await saveUser({
    ...user,
    securityQuestion: question as string,
    securityAnswerHash: await hashPassword(normalizeAnswer(answer as string)),
  });
}

const MAX_RESET_FAILURES = 5;
const RESET_LOCK_MS = 15 * 60 * 1000;

async function resetUser(username: string): Promise<UserRecord | null> {
  const userId = await findUserIdByUsername(username);
  const user = userId ? await getUserById(userId) : null;
  return user?.securityAnswerHash ? user : null;
}

// Only used when JWT_SECRET is unset, so stand-in questions then change on restart.
const standInKey = randomBytes(32);

/**
 * The security question to show for a username. One with no account gets a
 * stand-in, the same one every time, so the reset form doesn't reveal which
 * usernames exist.
 */
export async function securityQuestionFor(username: string): Promise<string> {
  const user = await resetUser(username);
  if (user?.securityQuestion) {
    return user.securityQuestion;
  }
  const key = process.env.JWT_SECRET?.trim() || standInKey;
  const digest = createHmac('sha256', key).update(normalizeUsername(username)).digest();
  return SECURITY_QUESTIONS[digest.readUInt32BE(0) % SECURITY_QUESTIONS.length]!;
}

/**
 * Sets a new password when the security answer is right, and stops every API
 * token issued before it. Too many wrong answers lock resets for a while.
 */
export async function resetPassword(username: string, answer: string, password: string): Promise<void> {
  checkPassword(password);
  const user = await resetUser(username);
  if (!user) {
    await hashPassword(answer);
    throw httpError('That answer is wrong', 400);
  }
  if (Date.now() < (user.resetLockedUntil ?? 0)) {
    throw httpError('Too many wrong answers. Try again in 15 minutes.', 429);
  }
  if (!(await verifyPassword(normalizeAnswer(answer), user.securityAnswerHash!))) {
    const failures = (user.resetFailures ?? 0) + 1;
    const locked = failures >= MAX_RESET_FAILURES;
    await saveUser({ ...user, resetFailures: locked ? 0 : failures, resetLockedUntil: locked ? Date.now() + RESET_LOCK_MS : 0 });
    throw httpError('That answer is wrong', 400);
  }
  await saveUser({
    ...user,
    passwordHash: await hashPassword(password),
    resetFailures: 0,
    resetLockedUntil: 0,
    tokenVersion: (user.tokenVersion ?? 0) + 1,
  });
}

/** JWT plugin sync: bind this Jagex accountHash (once) and auto-claim the RSN. */
export async function bindJagexAccountForSync(
  userId: string,
  username: string,
  accountHash: string,
): Promise<UserRecord> {
  if (!jwtUsersEnabled()) {
    throw httpError('Account auth is not enabled on this server', 501);
  }

  const hash = parseAccountHash(accountHash);
  const rsn = storageKey(username);
  await ensureUserDirs();

  const user = await getUserById(userId);
  if (!user) {
    throw httpError('Unauthorized', 401);
  }

  const existingRsn = await readJsonOrDefault<{ userId?: string } | null>(rsnClaimPath(rsn), null);
  if (existingRsn?.userId && existingRsn.userId !== userId) {
    throw httpError('Forbidden — that RSN is claimed by another account', 403);
  }

  const existingHash = await readJsonOrDefault<{ userId?: string } | null>(hashClaimPath(hash), null);
  if (existingHash?.userId && existingHash.userId !== userId) {
    throw httpError('Forbidden — that Jagex account is bound to another login', 403);
  }

  if (user.accountHash && user.accountHash !== hash) {
    throw httpError('Forbidden — this login is already bound to a different Jagex account', 403);
  }

  const next: UserRecord = {
    ...user,
    accountHash: user.accountHash ?? hash,
    rsns: user.rsns.includes(rsn) ? user.rsns : [...user.rsns, rsn],
  };
  const hashChanged = next.accountHash !== user.accountHash;
  const rsnChanged = next.rsns.length !== user.rsns.length;
  if (!hashChanged && !rsnChanged) {
    return next;
  }

  await atomicWriteFile(userPath(next.id), JSON.stringify(next, null, 2));
  if (hashChanged || !existingHash?.userId) {
    await atomicWriteFile(hashClaimPath(next.accountHash!), JSON.stringify({ userId: next.id }));
  }
  if (rsnChanged || !existingRsn?.userId) {
    await atomicWriteFile(rsnClaimPath(rsn), JSON.stringify({ userId: next.id }));
  }
  return next;
}

// The portfolio's account id. Checked before it becomes a file name.
const RONOVO_SUB_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function getUserByRonovoSub(sub: string): Promise<UserRecord | null> {
  if (!RONOVO_SUB_RE.test(sub)) return null;
  const claim = await readJsonOrDefault<{ userId?: string } | null>(ronovoClaimPath(sub), null);
  if (!claim?.userId) return null;
  const user = await getUserById(claim.userId);
  return user?.ronovoSub === sub ? user : null;
}

/**
 * The account tied to a Ronovo portfolio account, created on its first login
 * and named after it. Its password is random and never shown, so logging in
 * with Ronovo is the only way in.
 */
export async function ronovoUser(sub: string, ronovoName: string): Promise<UserRecord> {
  if (!RONOVO_SUB_RE.test(sub)) {
    throw httpError('Invalid Ronovo account', 400);
  }
  const existing = await getUserByRonovoSub(sub);
  if (existing) {
    return existing;
  }
  const base = USERNAME_RE.test(ronovoName) ? ronovoName : 'player';
  for (let n = 1; ; n++) {
    const username = n === 1 ? base : `${base.slice(0, 20 - String(n).length)}${n}`;
    const user = await createUser({ username, passwordHash: await hashPassword(randomUUID()), ronovoSub: sub });
    if (user) {
      await atomicWriteFile(ronovoClaimPath(sub), JSON.stringify({ userId: user.id }));
      return user;
    }
  }
}

/** Merges a browser's Flip bankrolls into the account's, keeping the newer value per player. */
export async function mergeBankrolls(
  userId: string,
  incoming: Record<string, SavedBankroll>,
): Promise<Record<string, SavedBankroll>> {
  const user = await getUserById(userId);
  if (!user) {
    throw httpError('Unauthorized', 401);
  }
  const merged = { ...user.bankrolls };
  let changed = false;
  for (const [bucket, entry] of Object.entries(incoming)) {
    if (!merged[bucket] || entry.savedAt > merged[bucket].savedAt) {
      merged[bucket] = entry;
      changed = true;
    }
  }
  if (changed) {
    await atomicWriteFile(userPath(user.id), JSON.stringify({ ...user, bankrolls: merged }, null, 2));
  }
  return merged;
}

export function jwtUsersEnabled(): boolean {
  return Boolean(process.env.JWT_SECRET?.trim());
}
