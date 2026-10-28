import { createPublicKey, randomBytes, timingSafeEqual } from 'crypto';
import type { KeyObject } from 'crypto';
import type { Request, Response } from 'express';
import { jwtVerify } from 'jose';
import { jwtAuthConfigured, lanModeConfigured, mintApiToken } from './auth.js';
import { httpError } from './errors.js';
import { getUserById, ronovoUser } from './users.js';

// Log in with a Ronovo portfolio account. /sso/login sends the browser to the
// portfolio, which posts a short-lived RS256 token back to /sso/callback. The
// callback finds or creates the tracker account tied to that Ronovo account and
// hands the page a one-time code in its URL, which the page trades at
// /api/auth/ronovo for this app's own API token.

const APP_ID = 'osrs-tracker';
const ISSUER = 'ronovo';
const STATE_COOKIE = 'osrs_tracker_sso_state';
const LOGIN_TTL_MS = 10 * 60 * 1000;

interface PendingLogin {
  userId: string;
  expires: number;
}

const pendingLogins = new Map<string, PendingLogin>();

/** Ronovo login needs its two settings and this server's own accounts (not LAN or guest posture). */
export function ronovoConfigured(): boolean {
  return Boolean(process.env.RONOVO_SSO_URL?.trim() && process.env.RONOVO_SSO_PUBLIC_KEY?.trim())
    && jwtAuthConfigured() && !lanModeConfigured();
}

let cachedKey: { raw: string; key: KeyObject } | undefined;

function publicKey(): KeyObject {
  const raw = process.env.RONOVO_SSO_PUBLIC_KEY!.trim();
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

export function ssoLogin(req: Request, res: Response): void {
  if (!ronovoConfigured()) {
    throw httpError('Not found', 404);
  }
  const state = randomBytes(16).toString('base64url');
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', path: '/sso', maxAge: LOGIN_TTL_MS, secure: req.secure });
  const query = new URLSearchParams({ app: APP_ID, return: `${req.protocol}://${req.get('host')}/sso/callback`, state });
  res.redirect(`${process.env.RONOVO_SSO_URL!.trim().replace(/\/+$/, '')}/sso/authorize?${query.toString()}`);
}

export async function ssoCallback(req: Request, res: Response): Promise<void> {
  if (!ronovoConfigured()) {
    throw httpError('Not found', 404);
  }
  const expected = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, { path: '/sso' });
  const { state, token } = (req.body ?? {}) as Record<string, unknown>;
  if (!expected || typeof state !== 'string' || typeof token !== 'string' || !sameString(expected, state)) {
    throw httpError('Invalid Ronovo login', 400);
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, publicKey(), {
      algorithms: ['RS256'], audience: APP_ID, issuer: ISSUER, requiredClaims: ['exp', 'sub'],
    }));
  } catch {
    throw httpError('Invalid Ronovo login', 400);
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw httpError('Invalid Ronovo login', 400);
  }

  const user = await ronovoUser(payload.sub, typeof payload.name === 'string' ? payload.name : '');
  const now = Date.now();
  for (const [code, login] of pendingLogins) {
    if (login.expires <= now) pendingLogins.delete(code);
  }
  const code = randomBytes(24).toString('base64url');
  pendingLogins.set(code, { userId: user.id, expires: now + LOGIN_TTL_MS });
  res.redirect(`/?ronovo=${code}`);
}

export async function authRonovo(req: Request, res: Response): Promise<void> {
  if (!ronovoConfigured()) {
    throw httpError('Not found', 404);
  }
  const code = (req.body as Record<string, unknown> | undefined)?.code;
  const login = typeof code === 'string' ? pendingLogins.get(code) : undefined;
  if (!login || login.expires <= Date.now()) {
    throw httpError('Ronovo login expired. Log in with Ronovo again.', 400);
  }
  pendingLogins.delete(code as string);
  const user = await getUserById(login.userId);
  if (!user) {
    throw httpError('Unauthorized', 401);
  }
  res.json({ token: await mintApiToken(user.id, user.tokenVersion), user: { id: user.id, username: user.username, rsns: user.rsns } });
}
