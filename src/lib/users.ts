import { createHash, randomUUID, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { ScryptOptions } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteFile } from './atomicWrite.js';
import { httpError } from './errors.js';
import { storageKey } from './sync.js';
import { readJsonOrDefault, storagePathFor } from './jsonStore.js';
import fs from 'fs/promises';

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
  email: string;
  passwordHash: string;
  rsns: string[];
  accountHash?: string;
  createdAt: string;
}

function userPath(userId: string): string {
  return storagePathFor(usersDir(), userId);
}

// The email is hashed rather than used as a filename directly. An address is
// not a safe path segment - `a@x.co/../../sync/someone` passes every
// address-shaped regex and would have escaped this directory - and hashing also
// keeps registered addresses off disk as readable names. isValidEmail() rejects
// separators too; this is the half that cannot be argued around.
function emailIndexPath(email: string): string {
  const digest = createHash('sha256').update(normalizeEmail(email)).digest('hex');
  return path.join(usersDir(), 'by-email', `${digest}.json`);
}

// Pre-hash installs wrote `<address>.json` here. Read-only, and only ever built
// from an address that already passed isValidEmail(), so it cannot traverse;
// findUserIdByEmail() migrates a hit onto the hashed path. Safe to delete once
// no deployment still holds a plaintext index file.
function legacyEmailIndexPath(email: string): string {
  return path.join(usersDir(), 'by-email', `${normalizeEmail(email)}.json`);
}

function rsnClaimPath(rsn: string): string {
  return path.join(usersDir(), 'rsn-claims', `${rsn}.json`);
}

function hashClaimPath(accountHash: string): string {
  return path.join(usersDir(), 'hash-claims', `${accountHash}.json`);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Shape check, plus an explicit ban on anything that could act as a path
// segment. The shape regex alone accepts `/`, `\` and `..`, which is how an
// address could once reach outside the users directory.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PATH_UNSAFE_RE = /[/\\]|\.\./;

function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
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
  await fs.mkdir(path.join(root, 'by-email'), { recursive: true });
  await fs.mkdir(path.join(root, 'rsn-claims'), { recursive: true });
  await fs.mkdir(path.join(root, 'hash-claims'), { recursive: true });
}

export function parseAccountHash(value: unknown): string {
  if (typeof value !== 'string' || !ACCOUNT_HASH_RE.test(value) || value === '-1') {
    throw httpError('Missing or invalid accountHash', 400);
  }
  return value;
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  return readJsonOrDefault<UserRecord | null>(userPath(userId), null);
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const index = await readJsonOrDefault<{ userId?: string } | null>(emailIndexPath(email), null);
  if (index?.userId) {
    return index.userId;
  }

  // Fall back to a pre-hash index file and move it onto the hashed path, so an
  // existing account keeps working across the upgrade without a migration step.
  const legacy = await readJsonOrDefault<{ userId?: string } | null>(legacyEmailIndexPath(email), null);
  if (!legacy?.userId) {
    return null;
  }
  await atomicWriteFile(emailIndexPath(email), JSON.stringify({ userId: legacy.userId }));
  await fs.rm(legacyEmailIndexPath(email), { force: true });
  return legacy.userId;
}

export async function registerUser(email: string, password: string): Promise<UserRecord> {
  if (!jwtUsersEnabled()) {
    throw httpError('Account auth is not enabled on this server', 501);
  }
  if (!isValidEmail(email)) {
    throw httpError('Invalid email', 400);
  }
  if (!password || password.length < 8) {
    throw httpError('Password must be at least 8 characters', 400);
  }

  await ensureUserDirs();
  const normalizedEmail = normalizeEmail(email);

  // An index entry only counts as "taken" if the account it points at actually
  // exists. Registration is two writes and cannot be one atomic step, so a
  // crash between them has to leave a state the next attempt can recover from -
  // see the write order below.
  const existingId = await findUserIdByEmail(normalizedEmail);
  if (existingId && (await getUserById(existingId))) {
    throw httpError('Email already registered', 409);
  }

  const user: UserRecord = {
    id: randomUUID(),
    email: normalizedEmail,
    passwordHash: await hashPassword(password),
    rsns: [],
    createdAt: new Date().toISOString(),
  };

  // Index first, record second. The index is the uniqueness claim, so this
  // ordering makes a half-finished registration fail closed: the email is held
  // by an id that resolves to nothing, which logs in as "invalid email or
  // password" and is re-claimable by the next attempt. The other order would
  // leave an orphan account with its email still free for someone else.
  await atomicWriteFile(emailIndexPath(normalizedEmail), JSON.stringify({ userId: user.id }));
  await atomicWriteFile(userPath(user.id), JSON.stringify(user, null, 2));
  return user;
}

export async function loginUser(email: string, password: string): Promise<UserRecord> {
  if (!jwtUsersEnabled()) {
    throw httpError('Account auth is not enabled on this server', 501);
  }
  // Same 401 as a wrong password: a malformed address must not be
  // distinguishable from an unregistered one.
  if (!isValidEmail(email)) {
    throw httpError('Invalid email or password', 401);
  }
  const userId = await findUserIdByEmail(email);
  if (!userId) {
    throw httpError('Invalid email or password', 401);
  }
  const user = await getUserById(userId);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw httpError('Invalid email or password', 401);
  }
  return user;
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

export function jwtUsersEnabled(): boolean {
  return Boolean(process.env.JWT_SECRET?.trim());
}
