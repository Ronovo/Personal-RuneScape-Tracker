import type { Request, Response } from 'express';
import { requireBearerToken, mintApiToken, mintWildcardToken, jwtAuthConfigured, lanModeConfigured } from './auth.js';
import {
  getUserById, loginUser, mergeBankrolls, registerUser, resetPassword, securityQuestionFor, setSecurityQuestion,
} from './users.js';
import type { SavedBankroll, UserRecord } from './users.js';
import { portfolioConfigured, portfolioUrl } from './portfolio.js';
import { httpError } from './errors.js';

function readBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    throw httpError('Invalid JSON body', 400);
  }
  return body as Record<string, unknown>;
}

function readCredentials(body: unknown): { username: string; password: string } {
  const { username, password } = readBody(body);
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw httpError('Username and password are required', 400);
  }
  // Reject oversized inputs before they reach scrypt - a multi-MB password
  // under concurrency is a cheap CPU-exhaustion vector. 254 still fits the
  // email addresses older accounts use as their username; 200 is well past any
  // real passphrase.
  if (username.length > 254 || password.length > 200) {
    throw httpError('Username or password too long', 400);
  }
  return { username: username.trim(), password };
}

function publicUser(user: UserRecord): { id: string; username: string; rsns: string[] } {
  return { id: user.id, username: user.username, rsns: user.rsns };
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
  const user = await registerUser(username, password, question, answer);
  const token = await mintApiToken(user.id, user.tokenVersion);
  res.status(201).json({ token, user: publicUser(user) });
}

export async function authLogin(req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    throw httpError('Sign-in is disabled in LAN mode', 403);
  }
  const { username, password } = readCredentials(req.body);
  const user = await loginUser(username, password);
  const token = await mintApiToken(user.id, user.tokenVersion);
  // Accounts made before security questions are asked to set one straight after signing in.
  res.json({ token, user: publicUser(user), needsSecurityQuestion: !user.securityAnswerHash && !user.portfolioSub });
}

export async function authMintToken(req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    // LAN posture has no accounts; the wildcard token is the plugin token.
    res.json({ token: await mintWildcardToken() });
    return;
  }
  await requireBearerToken(req);
  if (req.auth?.scope !== 'user' || !req.auth.userId) {
    throw httpError('Unauthorized', 401);
  }
  const user = await getUserById(req.auth.userId);
  if (!user) {
    throw httpError('Unauthorized', 401);
  }
  const token = await mintApiToken(user.id, user.tokenVersion);
  res.json({ token });
}

export async function authMe(req: Request, res: Response): Promise<void> {
  await requireBearerToken(req);
  if (req.auth?.scope !== 'user' || !req.auth.userId) {
    throw httpError('Unauthorized', 401);
  }
  const user = await getUserById(req.auth.userId);
  if (!user) {
    throw httpError('Unauthorized', 401);
  }
  res.json(publicUser(user));
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
  const bankrolls: Record<string, SavedBankroll> = {};
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
  await requireBearerToken(req);
  if (req.auth?.scope !== 'user' || !req.auth.userId) {
    throw httpError('Unauthorized', 401);
  }
  res.json({ bankrolls: await mergeBankrolls(req.auth.userId, readBankrolls(req.body)) });
}

export async function authSecurityQuestion(req: Request, res: Response): Promise<void> {
  await requireBearerToken(req);
  if (req.auth?.scope !== 'user' || !req.auth.userId) {
    throw httpError('Unauthorized', 401);
  }
  const { question, answer } = readBody(req.body);
  await setSecurityQuestion(req.auth.userId, question, answer);
  res.json({ saved: true });
}

// Two steps: the username brings up its security question, then the answer
// and a new password change it.
export async function authResetQuestion(req: Request, res: Response): Promise<void> {
  if (!jwtAuthConfigured() || lanModeConfigured()) {
    throw httpError('Account auth is not enabled on this server', 501);
  }
  const { username } = readBody(req.body);
  if (typeof username !== 'string' || !username.trim() || username.length > 254) {
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
  if (typeof answer !== 'string' || answer.length > 200) {
    throw httpError('That answer is wrong', 400);
  }
  await resetPassword(username, answer, password);
  res.json({ reset: true });
}
