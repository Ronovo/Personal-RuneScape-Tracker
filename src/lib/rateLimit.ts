import type { Request, Response, NextFunction } from 'express';

// In-process limiter for /api/*. Fine for a single Node process (Docker
// default). RATE_LIMIT_MAX=0 disables it for tests that fire many requests.

type HitLog = Map<string, number[]>;

interface RateLimitOptions {
  windowMs: number;
  max: number;
  // Bucket key; defaults to the caller's IP. Auth routes override this to
  // fold in the route + submitted email so login guessing is throttled per
  // account, not just per address.
  keyFn?: (req: Request) => string;
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

// Stricter limiter for /api/auth/{login,register,token} - brute-force
// protection on the credential endpoints. Keyed by IP + route + submitted
// email so one IP can't grind many accounts and one account can't be ground
// from many requests behind a shared NAT without also tripping the IP bucket.
export function authRateLimit(): (req: Request, res: Response, next: NextFunction) => void {
  return rateLimit({
    windowMs: envLimit('AUTH_RATE_LIMIT_WINDOW_MS', 60_000),
    max: envLimit('AUTH_RATE_LIMIT_MAX', 10),
    keyFn: (req) => {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      return `${clientIp(req)}|${req.path}|${email}`;
    },
  });
}
