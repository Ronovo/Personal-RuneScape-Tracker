import type { Request, Response } from 'express';
import { lanModeConfigured, mintApiToken, mintWildcardToken, publicUser, requireAccount, sendSignedIn } from './auth.js';
import { jwtAuthConfigured } from './config.js';
import {
  MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, loginUser, mergeBankrolls, registerUser, resetPassword,
  securityQuestionFor,
} from './users.js';
import type { SavedBankroll } from './users.js';
import { portfolioConfigured, portfolioUrl } from './portfolio.js';
import { httpError } from './errors.js';

function readBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    throw httpError('Invalid JSON body', 400);
  }
  return body as Record<string, unknown>;
}

export function readCredentials(body: unknown): { username: string; password: string } {
  const { username, password } = readBody(body);
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw httpError('Username and password are required', 400);
  }
  // Reject oversized inputs before they reach scrypt - a multi-MB password
  // under concurrency is a cheap CPU-exhaustion vector.
  const trimmed = username.trim();
  if (trimmed.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw httpError('Username or password too long', 400);
  }
  return { username: trimmed, password };
}

export async function authStatus(_req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    res.json({ mode: 'lan', accounts: false, lanToken: await mintWildcardToken() });
  } else if (jwtAuthConfigured()) {
    res.json({ mode: 'public', accounts: true, ...(portfolioConfigured() ? { portfolio: true, portfolioUrl: portfolioUrl() } : {}) });
  } else {
    res.json({ mode: 'guest', accounts: false });
  }
}

export async function authRegister(req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    throw httpError('Registration is disabled in LAN mode', 403);
  }
  const { username, password } = readCredentials(req.body);
  const { question, answer } = readBody(req.body);
  await sendSignedIn(res, await registerUser(username, password, question, answer), 201);
}

export async function authLogin(req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    throw httpError('Sign-in is disabled in LAN mode', 403);
  }
  const { username, password } = readCredentials(req.body);
  await sendSignedIn(res, await loginUser(username, password));
}

export async function authMintToken(req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    // LAN posture has no accounts; the wildcard token is the plugin token.
    res.json({ token: await mintWildcardToken() });
    return;
  }
  const user = await requireAccount(req);
  res.json({ token: await mintApiToken(user.id, user.tokenVersion) });
}

export async function authMe(req: Request, res: Response): Promise<void> {
  res.json(publicUser(await requireAccount(req)));
}

// Bucket names are "Playing as" names (or the guest bucket), so short; a cap
// on how many keeps one request from growing the user record without bound.
const MAX_BANKROLLS = 50;

function readBankrolls(body: unknown): Record<string, SavedBankroll> {
  const raw = (body as Record<string, unknown> | null)?.bankrolls;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw httpError('Invalid JSON body', 400);
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_BANKROLLS) {
    throw httpError('Too many bankrolls', 400);
  }
  // No prototype, so a bucket named __proto__ or toString is just a key.
  const bankrolls: Record<string, SavedBankroll> = Object.create(null);
  for (const [bucket, entry] of entries) {
    const { value, savedAt } = (entry ?? {}) as Record<string, unknown>;
    if (bucket.length <= 64 && typeof value === 'number' && Number.isFinite(value) && value >= 0
      && typeof savedAt === 'number' && Number.isFinite(savedAt)) {
      bankrolls[bucket] = { value, savedAt };
    }
  }
  return bankrolls;
}

export async function authBankrolls(req: Request, res: Response): Promise<void> {
  const user = await requireAccount(req);
  res.json({ bankrolls: await mergeBankrolls(user.id, readBankrolls(req.body)) });
}

// Two steps: the username brings up its security question, then the answer
// and a new password change it.
export async function authResetQuestion(req: Request, res: Response): Promise<void> {
  if (!jwtAuthConfigured() || lanModeConfigured()) {
    throw httpError('Account auth is not enabled on this server', 501);
  }
  const { username } = readBody(req.body);
  if (typeof username !== 'string' || !username.trim() || username.trim().length > MAX_USERNAME_LENGTH) {
    throw httpError('Enter your username', 400);
  }
  res.json({ question: await securityQuestionFor(username.trim()) });
}

export async function authResetPassword(req: Request, res: Response): Promise<void> {
  if (!jwtAuthConfigured() || lanModeConfigured()) {
    throw httpError('Account auth is not enabled on this server', 501);
  }
  const { username, password } = readCredentials(req.body);
  const { answer } = readBody(req.body);
  if (typeof answer !== 'string' || answer.length > MAX_PASSWORD_LENGTH) {
    throw httpError('That answer is wrong', 400);
  }
  await resetPassword(username, answer, password);
  res.json({ reset: true });
}
