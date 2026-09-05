import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Same SYNC_DATA_DIR-before-first-import requirement as sync.test.ts - app.js
// statically imports sync.js and watchlist.js, so createApp() has to come
// from a dynamic import performed after both env vars are set.
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-app-test-'));
const watchlistTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-app-watchlist-test-'));
process.env.SYNC_DATA_DIR = tmpDir;
process.env.WATCHLIST_DATA_DIR = watchlistTmpDir;
process.env.JWT_SECRET = 'app-test-secret';
process.env.LAN_MODE = '1';
process.env.RATE_LIMIT_MAX = '0';

const { createApp } = await import('./app.js');
const { mintWildcardToken } = await import('./auth.js');

const app = createApp();
const server = app.listen(0);
await new Promise<void>((resolve) => server.once('listening', resolve));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;
const TOKEN = await mintWildcardToken();
const AUTH = { Authorization: `Bearer ${TOKEN}` };

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(watchlistTmpDir, { recursive: true, force: true });
  delete process.env.JWT_SECRET;
  delete process.env.LAN_MODE;
});

test('route round-trip: sync then read back leagues/quests/collectionlog', async () => {
  const username = 'route-test-user';
  const postRes = await fetch(`${base}/api/sync/leagues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({
      username,
      // One real task id (region/difficulty/activityType should be joined
      // on) plus one the metadata import doesn't recognize, to check the
      // "Unknown" fallback a real drifted plugin id would hit.
      completedTasks: [
        { taskId: 'client-of-kourend', completedAt: '2024-01-01' },
        { taskId: 'not-a-real-task-id', completedAt: '2024-01-02' }
      ],
      quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }],
      collectionLog: { groups: [] },
      achievementDiary: [{ area: 'ARDOUGNE', tier: 'ELITE', complete: true }],
      combatAchievements: {
        points: 100,
        tasks: [{ task: 'ABYSSALSIRE_KILLCOUNT_1', complete: true }]
      }
    })
  });
  assert.equal(postRes.status, 200);

  const leaguesRes = await fetch(`${base}/api/leagues/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(leaguesRes.status, 200);
  const leagues = (await leaguesRes.json()) as {
    username: string;
    completedTasks: { taskId: string; name: string; region: string; difficulty: string; activityType: string }[];
    filters: { regions: string[]; difficulties: string[]; activityTypes: string[] };
  };
  assert.equal(leagues.username, username);
  assert.equal(leagues.completedTasks.length, 2);

  const known = leagues.completedTasks.find((t) => t.taskId === 'client-of-kourend')!;
  assert.equal(known.name, 'Client of Kourend');
  assert.equal(known.region, 'General');
  assert.equal(known.difficulty, 'Easy');
  assert.equal(known.activityType, 'Questing');

  const unknown = leagues.completedTasks.find((t) => t.taskId === 'not-a-real-task-id')!;
  assert.equal(unknown.name, 'Not A Real Task Id');
  assert.equal(unknown.region, 'Unknown');
  assert.equal(unknown.difficulty, 'Unknown');
  assert.equal(unknown.activityType, 'Unknown');

  assert.ok(leagues.filters.regions.includes('General'));
  assert.ok(leagues.filters.difficulties.includes('Easy'));
  assert.ok(leagues.filters.activityTypes.includes('Questing'));
  assert.ok(leagues.filters.activityTypes.includes('Combat Achievements'));
  assert.ok(!leagues.filters.regions.includes('Unknown'));
  assert.ok(!leagues.filters.difficulties.includes('Unknown'));
  assert.ok(!leagues.filters.activityTypes.includes('Unknown'));

  const questsRes = await fetch(`${base}/api/quests/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(questsRes.status, 200);
  const quests = (await questsRes.json()) as { quests: unknown[] };
  assert.equal(quests.quests.length, 1);

  const clogRes = await fetch(`${base}/api/collectionlog/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(clogRes.status, 200);
  const clog = (await clogRes.json()) as { username: string };
  assert.equal(clog.username, username);

  const diariesRes = await fetch(`${base}/api/diaries/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(diariesRes.status, 200);
  const diaries = (await diariesRes.json()) as { areas: unknown[] };
  assert.equal(diaries.areas.length, 1);

  const caRes = await fetch(`${base}/api/combatachievements/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(caRes.status, 200);
  const ca = (await caRes.json()) as { summary: { points: number; complete: number }; groups: { name: string }[] };
  assert.equal(ca.summary.points, 100);
  assert.equal(ca.summary.complete, 1);
  assert.ok(ca.groups.length >= 1);
});

test('POST sync omitting completedTasks preserves the previously synced tasks', async () => {
  const username = 'quests-only-usr';
  const firstRes = await fetch(`${base}/api/sync/leagues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({
      username,
      completedTasks: [{ taskId: 'client-of-kourend', completedAt: '2024-01-01' }]
    })
  });
  assert.equal(firstRes.status, 200);

  // Mirrors the plugin's "Sync Quests" button, which posts to /api/sync/quests.
  const secondRes = await fetch(`${base}/api/sync/quests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({
      username,
      quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }]
    })
  });
  assert.equal(secondRes.status, 200);

  const leaguesRes = await fetch(`${base}/api/leagues/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(leaguesRes.status, 200);
  const leagues = (await leaguesRes.json()) as { completedTasks: { taskId: string }[] };
  assert.equal(leagues.completedTasks.length, 1);
  assert.equal(leagues.completedTasks[0]?.taskId, 'client-of-kourend');

  const questsRes = await fetch(`${base}/api/quests/${encodeURIComponent(username)}`, { headers: AUTH });
  const quests = (await questsRes.json()) as { quests: unknown[] };
  assert.equal(quests.quests.length, 1);
});

test('POST syncing only quests on a brand-new account reports tasks as not synced, not zero', async () => {
  const username = 'quests-only-fresh';
  const res = await fetch(`${base}/api/sync/quests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({
      username,
      quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }]
    })
  });
  assert.equal(res.status, 200);

  // Never having synced tasks must read as "go sync", not "synced, 0 tasks".
  const leaguesRes = await fetch(`${base}/api/leagues/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(leaguesRes.status, 404);

  const questsRes = await fetch(`${base}/api/quests/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(questsRes.status, 200);
});

test('POST /api/sync/quests rejects extra section fields with 400', async () => {
  const res = await fetch(`${base}/api/sync/quests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({
      username: 'extra-field-user',
      quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }],
      completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }]
    })
  });
  assert.equal(res.status, 400);
});

test('section sync routes update only their section', async () => {
  const username = 'section-route-user';

  const tasksRes = await fetch(`${base}/api/sync/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({
      username,
      completedTasks: [{ taskId: 'client-of-kourend', completedAt: '2024-01-01' }]
    })
  });
  assert.equal(tasksRes.status, 200);

  const leaguesRes = await fetch(`${base}/api/leagues/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(leaguesRes.status, 200);

  const questsRes = await fetch(`${base}/api/sync/quests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({
      username,
      quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }]
    })
  });
  assert.equal(questsRes.status, 200);

  const questsRead = await fetch(`${base}/api/quests/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(questsRead.status, 200);
  const quests = (await questsRead.json()) as { quests: unknown[] };
  assert.equal(quests.quests.length, 1);

  const leagues = (await leaguesRes.json()) as { completedTasks: { taskId: string }[] };
  assert.equal(leagues.completedTasks.length, 1);
  assert.equal(leagues.completedTasks[0]?.taskId, 'client-of-kourend');
});

test('GET routes reject path traversal in the username with 400', async () => {
  const res = await fetch(`${base}/api/leagues/${encodeURIComponent('../evil')}`, { headers: AUTH });
  assert.equal(res.status, 400);
});

test('GET player data without a bearer token is 401 when auth is configured', async () => {
  const res = await fetch(`${base}/api/leagues/someone`);
  assert.equal(res.status, 401);
});

test('responses include security headers', async () => {
  const res = await fetch(`${base}/api/ge/search?q=abyssal`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'self'"));
  // Plain-HTTP request (no TLS, no trusted proxy) must not get HSTS.
  assert.equal(res.headers.get('strict-transport-security'), null);
});

test('GET /api/health reports ok and the running build, without auth', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok?: boolean; version?: string };
  assert.equal(body.ok, true);
  // The question after a rebuild is not "is something up" but "is this the
  // build I just made", so the version has to be real, not a placeholder.
  assert.match(body.version ?? '', /^\d+\.\d+\.\d+$/);
});

test('POST sync rejects a missing/wrong bearer token', async () => {
  const res = await fetch(`${base}/api/sync/leagues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'x', completedTasks: [] })
  });
  assert.equal(res.status, 401);
});

test('watchlist round-trip: empty by default, PUT persists, GET reads it back', async () => {
  const username = 'watchlist-test-user';

  const emptyRes = await fetch(`${base}/api/watchlist/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(emptyRes.status, 200);
  assert.deepEqual(((await emptyRes.json()) as { itemIds: number[] }).itemIds, []);

  const putRes = await fetch(`${base}/api/watchlist/${encodeURIComponent(username)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ itemIds: [561, 560, 561] })
  });
  assert.equal(putRes.status, 200);
  assert.deepEqual(((await putRes.json()) as { itemIds: number[] }).itemIds, [561, 560]);

  const getRes = await fetch(`${base}/api/watchlist/${encodeURIComponent(username)}`, { headers: AUTH });
  assert.equal(getRes.status, 200);
  assert.deepEqual(((await getRes.json()) as { itemIds: number[] }).itemIds, [561, 560]);
});

test('PUT watchlist without a token is 401 when auth is configured', async () => {
  const res = await fetch(`${base}/api/watchlist/someone`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds: [1] })
  });
  assert.equal(res.status, 401);
});

test('PUT watchlist rejects path traversal in the username with 400', async () => {
  const res = await fetch(`${base}/api/watchlist/${encodeURIComponent('../evil')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ itemIds: [1] })
  });
  assert.equal(res.status, 400);
});

test('PUT watchlist rejects more than 200 item ids', async () => {
  const res = await fetch(`${base}/api/watchlist/cap-user`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ itemIds: Array.from({ length: 201 }, (_, i) => i + 1) })
  });
  assert.equal(res.status, 400);
});

test('GET hiscores rejects a path-traversal username with 400', async () => {
  const res = await fetch(`${base}/api/hiscores/${encodeURIComponent('../evil')}`);
  assert.equal(res.status, 400);
});

// Errors thrown by middleware never reach a route, so asyncHandler cannot
// shape them. Before jsonErrors() existed, Express answered these with an HTML
// page containing a stack trace and absolute filesystem paths.
test('a malformed JSON body is a JSON 400, with no parser detail or stack', async () => {
  const res = await fetch(`${base}/api/sync/quests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: '{"bad"',
  });
  const body = await res.text();

  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(JSON.parse(body), { error: 'Invalid JSON body' });
  assert.ok(!body.includes('SyntaxError'), 'no parser class name');
  assert.ok(!body.includes('node_modules'), 'no filesystem paths');
  assert.ok(!body.includes('    at '), 'no stack frames');
});

test('a body over the 1mb cap is a JSON 413', async () => {
  const res = await fetch(`${base}/api/sync/quests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ username: 'x', pad: 'a'.repeat(1_200_000) }),
  });

  assert.equal(res.status, 413);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { error: 'Request body too large' });
});

test('an unknown /api path is a JSON 404, not the static handler HTML', async () => {
  const res = await fetch(`${base}/api/does-not-exist`);

  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

// The browser client only treats a response as an API error if it is JSON;
// anything else becomes "Stop the running tracker, run npm start again".
test('every error path an unauthenticated caller can reach answers in JSON', async () => {
  // Encoded, not raw: fetch normalises a literal `../..` out of the path
  // before it is sent, so the encoded form is the shape that actually arrives.
  const cases = [
    ['GET', `/api/hiscores/${encodeURIComponent('../../etc/passwd')}`],
    ['GET', '/api/ge/item/not-a-number'],
    ['POST', '/api/sync/tasks'],
    ['GET', '/api/nope'],
  ] as const;

  for (const [method, route] of cases) {
    const res = await fetch(`${base}${route}`, { method });
    assert.ok(res.status >= 400, `${method} ${route} should be an error`);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/, `${method} ${route}`);
    const body = await res.json() as { error?: unknown };
    assert.equal(typeof body.error, 'string', `${method} ${route} carries an error string`);
  }
});

// A tagged error is a sentence written for the caller; an untagged one is a
// crash whose message is a filesystem path or a parser internal. The status
// code alone doesn't tell them apart - a 501 saying "auth is not enabled" used
// to reach the client as "Internal error", which is exactly the wrong answer
// for a deployer who forgot to set JWT_SECRET.
test('jsonErrors keeps a deliberate 5xx message and masks an unexpected one', async () => {
  const { jsonErrors } = await import('./app.js');
  const { httpError } = await import('./errors.js');

  function capture(err: unknown): { status: number; body: unknown } {
    let status = 200;
    let body: unknown;
    const res = {
      headersSent: false,
      status(code: number) { status = code; return this; },
      json(payload: unknown) { body = payload; return this; },
    };
    jsonErrors(err, {} as never, res as never, () => undefined);
    return { status, body };
  }

  // Authored, whatever the status.
  assert.deepEqual(capture(httpError('Upstream is unavailable', 502)),
    { status: 502, body: { error: 'Upstream is unavailable' } });
  assert.deepEqual(capture(httpError('Account auth is not enabled on this server', 501)),
    { status: 501, body: { error: 'Account auth is not enabled on this server' } });
  assert.deepEqual(capture(httpError('Invalid username', 400)),
    { status: 400, body: { error: 'Invalid username' } });

  // Untagged: a crash, and its message is never sent.
  assert.deepEqual(capture(new Error('ENOENT: /home/someone/secret.json')),
    { status: 500, body: { error: 'Internal error' } });
  assert.deepEqual(capture('a thrown string'), { status: 500, body: { error: 'Internal error' } });

  // body-parser tags its own failures with a `type`, which wins over both.
  assert.deepEqual(capture(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', statusCode: 400 })),
    { status: 400, body: { error: 'Invalid JSON body' } });
});
