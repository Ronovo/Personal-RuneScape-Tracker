import { createPublicKey, randomBytes, timingSafeEqual } from 'crypto';
import type { KeyObject } from 'crypto';
import type { Request, Response } from 'express';
import { jwtVerify } from 'jose';
import { lanModeConfigured, sendSignedIn } from './auth.js';
import { readCredentials } from './authRoutes.js';
import { jwtAuthConfigured } from './config.js';
import { httpError } from './errors.js';
import { getUserById, getUserByPortfolioSub, linkPortfolio, loginUser, portfolioUser } from './users.js';

// Log in with a portfolio account. /sso/login sends the browser to the
// portfolio, which posts a short-lived RS256 token back to /sso/callback. When
// a tracker account is linked to that portfolio account, the callback hands the
// page a one-time code in its URL (?portfolio=), which the page trades at
// /api/auth/portfolio for this app's own API token. The first time, it sends
// the page to link.html with a different code (?link=) instead, where the
// player links an account they already have or makes a new one. The two names
// differ because every page's chrome script consumes ?portfolio=. A callback
// that fails sends the browser to login.html with the reason in ?error=.

const APP_ID = 'osrs-tracker';
const ISSUER = 'portfolio';
const STATE_COOKIE = 'osrs_tracker_sso_state';
const LOGIN_TTL_MS = 10 * 60 * 1000;
const EXPIRED_LOGIN = 'Your portfolio login expired. Try again.';
const REJECTED_LOGIN = "That portfolio login didn't check out. Try again.";

interface PendingLogin {
  userId: string;
  expires: number;
}

interface PendingChoice {
  sub: string;
  name: string;
  expires: number;
}

const pendingLogins = new Map<string, PendingLogin>();
const pendingChoices = new Map<string, PendingChoice>();

/** Portfolio login needs its two settings and this server's own accounts (not LAN or guest posture). */
export function portfolioConfigured(): boolean {
  return Boolean(process.env.PORTFOLIO_SSO_URL?.trim() && process.env.PORTFOLIO_SSO_PUBLIC_KEY?.trim())
    && jwtAuthConfigured() && !lanModeConfigured();
}

/** The portfolio's address. Only meaningful when portfolioConfigured(). */
export function portfolioUrl(): string {
  return process.env.PORTFOLIO_SSO_URL!.trim().replace(/\/+$/, '');
}

let cachedKey: { raw: string; key: KeyObject } | undefined;

function publicKey(): KeyObject {
  const raw = process.env.PORTFOLIO_SSO_PUBLIC_KEY!.trim();
  if (cachedKey?.raw !== raw) {
    cachedKey = { raw, key: createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' }) };
  }
  return cachedKey.key;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireConfigured(): void {
  if (!portfolioConfigured()) {
    throw httpError('Not found', 404);
  }
}

function newCode<T extends { expires: number }>(pending: Map<string, T>, entry: T): string {
  const now = Date.now();
  for (const [code, held] of pending) {
    if (held.expires <= now) pending.delete(code);
  }
  const code = randomBytes(24).toString('base64url');
  pending.set(code, entry);
  return code;
}

function readCode(req: Request): string {
  const code = (req.body as Record<string, unknown> | undefined)?.code;
  return typeof code === 'string' ? code : '';
}

export function ssoLogin(req: Request, res: Response): void {
  requireConfigured();
  const state = randomBytes(16).toString('base64url');
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', path: '/sso', maxAge: LOGIN_TTL_MS, secure: req.secure });
  const query = new URLSearchParams({ app: APP_ID, return: `${req.protocol}://${req.get('host')}/sso/callback`, state });
  res.redirect(`${portfolioUrl()}/sso/authorize?${query.toString()}`);
}

function loginFailed(res: Response, message: string): void {
  res.redirect(`/login.html?${new URLSearchParams({ error: message }).toString()}`);
}

export async function ssoCallback(req: Request, res: Response): Promise<void> {
  requireConfigured();
  const expected = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, { path: '/sso' });
  const { state, token } = (req.body ?? {}) as Record<string, unknown>;
  if (!expected || typeof state !== 'string' || !sameString(expected, state)) {
    loginFailed(res, EXPIRED_LOGIN);
    return;
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(typeof token === 'string' ? token : '', publicKey(), {
      algorithms: ['RS256'], audience: APP_ID, issuer: ISSUER, requiredClaims: ['exp', 'sub'],
    }));
  } catch {
    loginFailed(res, REJECTED_LOGIN);
    return;
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    loginFailed(res, REJECTED_LOGIN);
    return;
  }

  const expires = Date.now() + LOGIN_TTL_MS;
  const user = await getUserByPortfolioSub(payload.sub);
  if (user) {
    res.redirect(`/?portfolio=${newCode(pendingLogins, { userId: user.id, expires })}`);
    return;
  }
  const name = typeof payload.name === 'string' ? payload.name : '';
  res.redirect(`/link.html?link=${newCode(pendingChoices, { sub: payload.sub, name, expires })}`);
}

export async function authPortfolio(req: Request, res: Response): Promise<void> {
  requireConfigured();
  const code = readCode(req);
  const login = pendingLogins.get(code);
  if (!login || login.expires <= Date.now()) {
    throw httpError('Portfolio login expired. Log in with your portfolio account again.', 400);
  }
  pendingLogins.delete(code);
  const user = await getUserById(login.userId);
  if (!user) {
    throw httpError('Unauthorized', 401);
  }
  await sendSignedIn(res, user);
}

function heldChoice(req: Request): { code: string; choice: PendingChoice } {
  requireConfigured();
  const code = readCode(req);
  const choice = pendingChoices.get(code);
  if (!choice || choice.expires <= Date.now()) {
    throw httpError('Log in with your portfolio account again.', 400);
  }
  return { code, choice };
}

/** The portfolio username waiting for the player to choose an account. */
export function authPortfolioPending(req: Request, res: Response): void {
  res.json({ username: heldChoice(req).choice.name });
}

export async function authPortfolioLink(req: Request, res: Response): Promise<void> {
  const { code, choice } = heldChoice(req);
  const { username, password } = readCredentials(req.body);
  const user = await loginUser(username, password);
  const linked = await linkPortfolio(user.id, choice.sub);
  pendingChoices.delete(code);
  await sendSignedIn(res, linked);
}

export async function authPortfolioNew(req: Request, res: Response): Promise<void> {
  const { code, choice } = heldChoice(req);
  // Used up before the first await, so a second click can't make a second account.
  pendingChoices.delete(code);
  await sendSignedIn(res, await portfolioUser(choice.sub, choice.name));
}
