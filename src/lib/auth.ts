import type { Request } from 'express';
import type { JWTPayload } from 'jose';
import { SignJWT, jwtVerify } from 'jose';
import { httpError } from './errors.js';
import { getUserById } from './users.js';

// Every credential is a JWT signed with JWT_SECRET. Two kinds:
//   - wildcard ({ scope: 'all' }, no sub): any-player access, no account, no
//     expiry, byte-identical every mint. Only honoured while LAN_MODE is set.
//   - scoped   ({ sub: userId }): one player's account, RSN-scoped, 90-day.
// LAN_MODE picks the deployment posture; there is no separate shared-secret path.

export type AuthScope = 'all' | 'user';

export interface AuthContext {
  scope: AuthScope;
  userId?: string; // scope === 'user' only
  rsns?: string[]; // scope === 'user' only
}

declare global {
  // Express's own types are declared in a namespace, so augmenting Request
  // has to be too - there is no module-syntax equivalent for this.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const API_TOKEN_TTL = '90d';
const WILDCARD_CLAIMS = { typ: 'api', scope: 'all' } as const;

export function jwtAuthConfigured(): boolean {
  return Boolean(process.env.JWT_SECRET?.trim());
}

/** LAN posture: the server mints a wildcard token and accepts wildcard tokens. */
export function lanModeConfigured(): boolean {
  return Boolean(process.env.LAN_MODE?.trim()) && jwtAuthConfigured();
}

export function authConfigured(): boolean {
  return jwtAuthConfigured();
}

function jwtSecretKey(): Uint8Array | undefined {
  const secret = process.env.JWT_SECRET?.trim();
  return secret ? new TextEncoder().encode(secret) : undefined;
}

export function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    return undefined;
  }
  const token = header.slice('Bearer '.length).trim();
  return token || undefined;
}

async function resolveScopedAuth(payload: JWTPayload): Promise<AuthContext> {
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw httpError('Unauthorized', 401);
  }
  const user = await getUserById(payload.sub);
  if (!user) {
    throw httpError('Unauthorized', 401);
  }
  return { scope: 'user', userId: user.id, rsns: [...user.rsns] };
}

let warnedAuthNotConfigured = false;

/** Sync POSTs: fail closed unless JWT_SECRET is configured. */
export async function requireBearerToken(req: Request): Promise<void> {
  if (!authConfigured()) {
    if (!warnedAuthNotConfigured) {
      console.error('[auth] JWT_SECRET is not set — sync requests are rejected as Unauthorized.');
      warnedAuthNotConfigured = true;
    }
    throw httpError('Unauthorized', 401);
  }

  const token = extractBearerToken(req);
  const secret = jwtSecretKey();
  if (!token || !secret) {
    throw httpError('Unauthorized', 401);
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] }));
  } catch {
    throw httpError('Unauthorized', 401);
  }
  if (payload.typ !== 'api') {
    throw httpError('Unauthorized', 401);
  }

  if (payload.scope === 'all') {
    // A validly-signed wildcard token is inert unless this host is in LAN posture.
    if (!lanModeConfigured()) {
      throw httpError('Unauthorized', 401);
    }
    req.auth = { scope: 'all' };
    return;
  }

  req.auth = await resolveScopedAuth(payload);
}

/** Player GETs / watchlist: open only when no auth mode is configured. */
export async function requirePlayerDataAuth(req: Request): Promise<void> {
  if (!authConfigured()) {
    return;
  }
  await requireBearerToken(req);
}

export async function mintApiToken(userId: string): Promise<string> {
  const secret = jwtSecretKey();
  if (!secret) {
    throw httpError('Account auth is not enabled on this server', 501);
  }

  return new SignJWT({ typ: 'api' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(API_TOKEN_TTL)
    .sign(secret);
}

/**
 * The LAN wildcard token. No `iat`/`exp`, so every mint is byte-identical for a
 * given JWT_SECRET — the value printed on startup stays stable across restarts.
 * Gated only on the secret (not LAN_MODE) so startup and tests can mint freely;
 * requireBearerToken is what enforces LAN posture on the way in.
 */
export async function mintWildcardToken(): Promise<string> {
  const secret = jwtSecretKey();
  if (!secret) {
    throw httpError('JWT_SECRET is not set', 501);
  }
  return new SignJWT(WILDCARD_CLAIMS).setProtectedHeader({ alg: 'HS256' }).sign(secret);
}
