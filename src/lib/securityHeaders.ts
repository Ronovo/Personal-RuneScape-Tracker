import type { Request, Response, NextFunction } from 'express';
import { ronovoConfigured, ronovoUrl } from './ronovo.js';

// Wiki item icons and the Ronovo portfolio's /sso/me are the only cross-origin
// resources the UI loads. Scripts and styles stay same-origin; innerHTML is
// used for markup, not inline JS.

function connectSrc(): string {
  const url = ronovoConfigured() ? ronovoUrl() : '';
  return URL.canParse(url) ? `'self' ${new URL(url).origin}` : "'self'";
}

function csp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https://oldschool.runescape.wiki data:",
    "font-src 'self'",
    `connect-src ${connectSrc()}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', csp());
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // Only advertise HSTS to clients that reached us over HTTPS - req.secure is
  // true for direct TLS, or behind a proxy when TRUST_PROXY is set and
  // X-Forwarded-Proto is https. A plain-HTTP LAN host never sends it.
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
