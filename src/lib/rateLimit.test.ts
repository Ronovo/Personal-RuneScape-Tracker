import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, pruneStale, envLimit } from './rateLimit.js';
import type { Request, Response, NextFunction } from 'express';

function fakeReq(ip = '127.0.0.1'): Request {
  return { ip, socket: { remoteAddress: ip } } as Request;
}

function countingRes(): { res: Response; status: () => number } {
  let code = 200;
  const res = { status(c: number) { code = c; return this; }, json() { return this; } } as unknown as Response;
  return { res, status: () => code };
}

test('rateLimit returns 429 after max hits in the window', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 2 });
  let status = 200;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  let nextCount = 0;
  const next: NextFunction = () => { nextCount++; };

  mw(fakeReq(), res, next);
  mw(fakeReq(), res, next);
  assert.equal(nextCount, 2);
  mw(fakeReq(), res, next);
  assert.equal(status, 429);
  assert.equal(nextCount, 2);
});

test('rateLimit with max 0 never blocks', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 0 });
  let nextCount = 0;
  const res = {} as Response;
  for (let i = 0; i < 5; i++) mw(fakeReq(), res, () => { nextCount++; });
  assert.equal(nextCount, 5);
});

test('keyFn buckets requests separately', () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1, keyFn: (req) => String(req.ip) });
  const { res, status } = countingRes();
  const noop: NextFunction = () => {};

  mw(fakeReq('1.1.1.1'), res, noop);
  mw(fakeReq('2.2.2.2'), res, noop); // different key - still allowed
  assert.equal(status(), 200);
  mw(fakeReq('1.1.1.1'), res, noop); // second hit on the first key
  assert.equal(status(), 429);
});

test('pruneStale drops keys with only stale timestamps, keeps live ones', () => {
  const now = 1_000_000;
  const hits = new Map<string, number[]>([
    ['stale', [now - 90_000, now - 70_000]],
    ['fresh', [now - 90_000, now - 10_000]],
    ['empty', []],
  ]);
  pruneStale(hits, now, 60_000);
  assert.deepEqual([...hits.keys()], ['fresh']);
});

// RATE_LIMIT_MAX= (blank, the shape .env.example uses) used to parse as 0,
// which this module reads as "never limit" - so blanking the line silently
// removed brute-force protection from /api/auth/login.
test('envLimit treats a blank or junk value as unset, but honours an explicit 0', () => {
  const KEY = 'OSRS_TEST_LIMIT';
  const cases: [string | undefined, number][] = [
    [undefined, 120],
    ['', 120],
    ['   ', 120],
    ['not-a-number', 120],
    ['0', 0],
    ['5', 5],
    [' 42 ', 42],
  ];

  for (const [value, expected] of cases) {
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
    assert.equal(envLimit(KEY, 120), expected, `value ${JSON.stringify(value)}`);
  }
  delete process.env[KEY];
});
