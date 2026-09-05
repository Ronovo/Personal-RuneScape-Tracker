import type { Request, Response } from 'express';
import { requireBearerToken, mintApiToken, mintWildcardToken, jwtAuthConfigured, lanModeConfigured } from './auth.js';
import { getUserById, loginUser, registerUser } from './users.js';
import { httpError } from './errors.js';

function readCredentials(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== 'object') {
    throw httpError('Invalid JSON body', 400);
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw httpError('Email and password are required', 400);
  }
  // Reject oversized inputs before they reach scrypt - a multi-MB password
  // under concurrency is a cheap CPU-exhaustion vector. 254 is the RFC 5321
  // address cap; 200 is well past any real passphrase.
  if (email.length > 254 || password.length > 200) {
    throw httpError('Email or password too long', 400);
  }
  return { email, password };
}

export async function authStatus(_req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    res.json({ mode: 'lan', accounts: false, lanToken: await mintWildcardToken() });
  } else if (jwtAuthConfigured()) {
    res.json({ mode: 'public', accounts: true });
  } else {
    res.json({ mode: 'guest', accounts: false });
  }
}

export async function authRegister(req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    throw httpError('Registration is disabled in LAN mode', 403);
  }
  const { email, password } = readCredentials(req.body);
  const user = await registerUser(email, password);
  const token = await mintApiToken(user.id);
  res.status(201).json({ token, user: { id: user.id, email: user.email, rsns: user.rsns } });
}

export async function authLogin(req: Request, res: Response): Promise<void> {
  if (lanModeConfigured()) {
    throw httpError('Sign-in is disabled in LAN mode', 403);
  }
  const { email, password } = readCredentials(req.body);
  const user = await loginUser(email, password);
  const token = await mintApiToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email, rsns: user.rsns } });
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
  const token = await mintApiToken(user.id);
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
  res.json({ id: user.id, email: user.email, rsns: user.rsns });
}
