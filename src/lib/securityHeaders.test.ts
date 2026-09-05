import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { securityHeaders } from './securityHeaders.js';

function run(secure: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  const req = { secure } as Request;
  const res = { setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; } } as unknown as Response;
  let nexted = false;
  securityHeaders(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  return headers;
}

test('always sets nosniff, frame, referrer and a locked-down CSP', () => {
  const h = run(false);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['x-frame-options'], 'DENY');
  assert.equal(h['referrer-policy'], 'no-referrer');
  const csp = h['content-security-policy'] ?? '';
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(!csp.includes('unsafe-inline'));
  assert.ok(csp.includes("frame-ancestors 'none'"));
});

test('HSTS is sent only on HTTPS requests', () => {
  assert.equal(run(false)['strict-transport-security'], undefined);
  assert.equal(run(true)['strict-transport-security'], 'max-age=31536000; includeSubDomains');
});
