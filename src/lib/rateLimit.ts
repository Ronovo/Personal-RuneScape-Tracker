import type { Request, Response, NextFunction } from 'express';

// In-process limiter for /api/*. Fine for a single Node process (Docker
// default). RATE_LIMIT_MAX=0 disables it for tests that fire many requests.

type HitLog = Map<string, number[]>;

interface RateLimitOptions {
  windowMs: number;
  max: number;
  // Bucket key; defaults to the caller's IP. Null leaves the request out of
  // this limiter.
  keyFn?: (req: Request) => string | null;
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// Drop bucket keys whose every timestamp is older than the window. Called on a
// timer so IPs that are seen once and never again don't accumulate forever on
// a long-running public host.
export function pruneStale(hits: Map<string, number[]>, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  for (const [key, times] of hits) {
    if (times.every((t) => t <= cutoff)) hits.delete(key);
  }
}

export function rateLimit(options: RateLimitOptions): (req: Request, res: Response, next: NextFunction) => void {
  const hits: HitLog = new Map();
  const { windowMs, max, keyFn } = options;

  // The per-key arrays are pruned on access, but a key that is never hit
  // again would linger forever. Sweep fully-stale keys once per window;
  // unref() so this timer never keeps the process alive.
  if (max > 0) {
    const sweep = setInterval(() => pruneStale(hits, Date.now(), windowMs), windowMs);
    sweep.unref?.();
  }

  return (req, res, next) => {
    if (max <= 0) {
      next();
      return;
    }

    const key = keyFn ? keyFn(req) : clientIp(req);
    if (key === null) {
      next();
      return;
    }
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= max) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

// `??` alone would only catch an unset variable: `RATE_LIMIT_MAX=` (the shape
// .env.example uses for every optional setting) is an empty string, and
// Number('') is 0 - which this module reads as "never limit". A blanked line
// has to mean "use the default", not "switch the limiter off".
export function envLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function apiRateLimit(): (req: Request, res: Response, next: NextFunction) => void {
  return rateLimit({
    windowMs: envLimit('RATE_LIMIT_WINDOW_MS', 60_000),
    max: envLimit('RATE_LIMIT_MAX', 120),
  });
}

function submittedUsername(req: Request): string {
  const body = req.body as { username?: unknown } | undefined;
  return typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
}

// Stricter limiter for the credential routes (/api/auth/*). Each request counts
// against two buckets: one per address, route and submitted username, and one
// per route and username alone, so guesses at one account spread over many
// addresses still hit the limit.
export function authRateLimit(): (req: Request, res: Response, next: NextFunction) => void {
  const windowMs = envLimit('AUTH_RATE_LIMIT_WINDOW_MS', 60_000);
  const max = envLimit('AUTH_RATE_LIMIT_MAX', 10);
  const perAddress = rateLimit({ windowMs, max, keyFn: (req) => `${clientIp(req)}|${req.path}|${submittedUsername(req)}` });
  const perAccount = rateLimit({
    windowMs,
    max,
    keyFn: (req) => (submittedUsername(req) ? `${req.path}|${submittedUsername(req)}` : null),
  });
  return (req, res, next) => perAddress(req, res, () => perAccount(req, res, next));
}
