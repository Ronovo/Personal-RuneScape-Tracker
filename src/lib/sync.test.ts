import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// SYNC_DIR is read from SYNC_DATA_DIR at module load time, so it has to be
// set before sync.js is first imported anywhere in this process - a plain
// top-level `import` would already have run that code by the time we could
// set it, since ESM imports are evaluated before the importing module's own
// top-level statements.
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-sync-test-'));
process.env.SYNC_DATA_DIR = tmpDir;

const { storageKey, requireBearerToken, requirePlayerDataAuth, assertAllowedUsername, parseLeaguesSyncPayload, parseSectionSyncPayload, acceptLeaguesSync, acceptSectionSync, loadLeaguesSync } = await import('./sync.js');
// auth reads env per-request, so importing this here (before LAN_MODE is set) is fine.
const { mintWildcardToken } = await import('./auth.js');

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function fakeReq(authorization?: string): Parameters<typeof requireBearerToken>[0] {
  return { headers: { authorization } } as Parameters<typeof requireBearerToken>[0];
}

function fakeSyncReq(body: unknown, token: string): Parameters<typeof acceptLeaguesSync>[0] {
  return { headers: { authorization: `Bearer ${token}` }, body } as Parameters<typeof acceptLeaguesSync>[0];
}

function fakeSectionSyncReq(body: unknown, token: string): Parameters<typeof acceptSectionSync>[0] {
  return { headers: { authorization: `Bearer ${token}` }, body } as Parameters<typeof acceptSectionSync>[0];
}

// Runs fn in LAN posture (JWT_SECRET + LAN_MODE set), handing it a freshly
// minted wildcard token. Restores env afterwards - and awaits fn itself so the
// restore can't fire while an async test body is still mid-flight.
async function withLanMode<T>(fn: (token: string) => T | Promise<T>): Promise<T> {
  const savedSecret = process.env.JWT_SECRET;
  const savedLan = process.env.LAN_MODE;
  process.env.JWT_SECRET = 'sync-test-secret';
  process.env.LAN_MODE = '1';
  try {
    return await fn(await mintWildcardToken());
  } finally {
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
    if (savedLan === undefined) delete process.env.LAN_MODE;
    else process.env.LAN_MODE = savedLan;
  }
}

test('storageKey rejects path traversal and invalid usernames', () => {
  for (const bad of ['../evil', '..%2Fevil', 'a/b', 'a\\b', '', 'x'.repeat(30)]) {
    assert.throws(() => storageKey(bad), /Invalid username/);
  }
});

test('storageKey accepts a normal display name', () => {
  assert.equal(storageKey('Zezima 2'), 'zezima 2');
});

test('storageKey folds non-breaking spaces', () => {
  assert.equal(storageKey('Zezima\u00A02'), 'zezima 2');
});

test('parseLeaguesSyncPayload canonicalizes username to storage key form', () => {
  const result = parseLeaguesSyncPayload({ username: 'Zezima\u00A02' });
  assert.equal(result.username, 'zezima 2');
});

test('requireBearerToken is fail-closed when no auth mode is configured', async () => {
  const savedJwt = process.env.JWT_SECRET;
  const savedLan = process.env.LAN_MODE;
  delete process.env.JWT_SECRET;
  delete process.env.LAN_MODE;
  try {
    await assert.rejects(() => requireBearerToken(fakeReq('Bearer anything')), /Unauthorized/);
  } finally {
    if (savedJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwt;
    if (savedLan === undefined) delete process.env.LAN_MODE;
    else process.env.LAN_MODE = savedLan;
  }
});

test('requireBearerToken rejects a bad token and accepts the wildcard token', async () => {
  await withLanMode(async (token) => {
    await assert.rejects(() => requireBearerToken(fakeReq('Bearer not-a-jwt')), /Unauthorized/);
    await assert.rejects(() => requireBearerToken(fakeReq(undefined)), /Unauthorized/);
    await requireBearerToken(fakeReq(`Bearer ${token}`));
  });
});

test('parseLeaguesSyncPayload rejects missing/invalid fields', () => {
  assert.throws(() => parseLeaguesSyncPayload({ completedTasks: [] }), /username/i);
  assert.throws(() => parseLeaguesSyncPayload({ username: 'a', completedTasks: 'nope' }), /completedTasks/i);
  assert.throws(() =>
    parseLeaguesSyncPayload({
      username: 'a',
      completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }, { taskId: 42 }]
    })
  );
});

test('parseLeaguesSyncPayload accepts a payload that omits completedTasks entirely', () => {
  const result = parseLeaguesSyncPayload({ username: 'a' });
  assert.equal(result.completedTasks, undefined);
});

test('parseLeaguesSyncPayload filters fake/placeholder quests', () => {
  const result = parseLeaguesSyncPayload({
    username: 'a',
    completedTasks: [],
    quests: [
      { id: 1, name: "Cook's Assistant", state: 'FINISHED' },
      { id: -1, name: 'Negative id', state: 'NOT_STARTED' },
      { id: 2, name: 'Fake Quest', state: 'NOT_STARTED' }
    ]
  });
  assert.deepEqual(result.quests?.map((q) => q.name), ["Cook's Assistant"]);
});

test('parseLeaguesSyncPayload rejects a collection log missing groups', () => {
  assert.throws(() =>
    parseLeaguesSyncPayload({
      username: 'a',
      completedTasks: [],
      collectionLog: { itemsObtained: 0, itemsAvailable: 0 }
    })
  );
});

test('completedTasks accepts a valid source, omitted source, and rejects an invalid one', () => {
  assert.doesNotThrow(() =>
    parseLeaguesSyncPayload({
      username: 'a',
      completedTasks: [{ taskId: 't1', completedAt: '2024-01-01', source: 'MANUAL' }]
    })
  );
  assert.doesNotThrow(() =>
    parseLeaguesSyncPayload({
      username: 'a',
      completedTasks: [{ taskId: 't1', completedAt: '2024-01-01', source: 'AUTO' }]
    })
  );
  assert.doesNotThrow(() =>
    parseLeaguesSyncPayload({
      username: 'a',
      completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }]
    })
  );
  assert.throws(() =>
    parseLeaguesSyncPayload({
      username: 'a',
      completedTasks: [{ taskId: 't1', completedAt: '2024-01-01', source: 'bogus' }]
    })
  );
});

test('acceptLeaguesSync keeps quests/collectionLog when a later sync omits them', async () => {
  await withLanMode(async (token) => {
    const first = await acceptLeaguesSync(
      fakeSyncReq(
        {
          username: 'merge-test-user',
          completedTasks: [],
          quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }],
          collectionLog: { groups: [] }
        },
        token
      )
    );
    assert.equal(first.quests?.length, 1);
    assert.ok(first.collectionLog);

    const second = await acceptLeaguesSync(
      fakeSyncReq({ username: 'merge-test-user', completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }] }, token)
    );
    assert.equal(second.quests?.length, 1);
    assert.ok(second.collectionLog);
    assert.equal(second.completedTasks?.length, 1);
  });
});

test('acceptLeaguesSync keeps completedTasks when a later sync omits it', async () => {
  await withLanMode(async (token) => {
    const first = await acceptLeaguesSync(
      fakeSyncReq(
        {
          username: 'ct-merge-user',
          completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }]
        },
        token
      )
    );
    assert.equal(first.completedTasks?.length, 1);

    // A quests-only sync (the plugin's "Sync Quests" button) omits
    // completedTasks entirely -- it must not wipe what's already stored.
    const second = await acceptLeaguesSync(
      fakeSyncReq(
        {
          username: 'ct-merge-user',
          quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }]
        },
        token
      )
    );
    assert.equal(second.completedTasks?.length, 1);
    assert.equal(second.completedTasks?.[0]?.taskId, 't1');
    assert.equal(second.quests?.length, 1);
  });
});

test('acceptLeaguesSync keeps completedTasks when a later sync sends an empty array', async () => {
  await withLanMode(async (token) => {
    const first = await acceptLeaguesSync(
      fakeSyncReq(
        {
          username: 'empty-array-user',
          completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }]
        },
        token
      )
    );
    assert.equal(first.completedTasks?.length, 1);

    const second = await acceptLeaguesSync(
      fakeSyncReq(
        { username: 'empty-array-user', completedTasks: [] },
        token
      )
    );
    assert.equal(second.completedTasks?.length, 1);
    assert.equal(second.completedTasks?.[0]?.taskId, 't1');
  });
});

test('parseLeaguesSyncPayload rejects invalid achievement diary and combat achievements', () => {
  assert.throws(() =>
    parseLeaguesSyncPayload({ username: 'a', achievementDiary: 'nope' })
  );
  assert.throws(() =>
    parseLeaguesSyncPayload({
      username: 'a',
      achievementDiary: [{ area: 'ARDOUGNE', tier: 'INVALID', complete: true }]
    })
  );
  assert.throws(() =>
    parseLeaguesSyncPayload({ username: 'a', combatAchievements: { points: 'nope', tasks: [] } })
  );
});

test('parseLeaguesSyncPayload accepts achievement diary and combat achievements', () => {
  const result = parseLeaguesSyncPayload({
    username: 'a',
    achievementDiary: [{ area: 'ARDOUGNE', tier: 'ELITE', complete: true }],
    combatAchievements: {
      points: 100,
      tasks: [{ task: 'ABYSSALSIRE_KILLCOUNT_1', complete: true }]
    }
  });
  assert.equal(result.achievementDiary?.length, 1);
  assert.equal(result.combatAchievements?.points, 100);
  assert.equal(result.combatAchievements?.tasks.length, 1);
});

test('acceptLeaguesSync keeps achievementDiary when a later sync sends an empty array', async () => {
  await withLanMode(async (token) => {
    const first = await acceptLeaguesSync(
      fakeSyncReq(
        {
          username: 'diary-user',
          achievementDiary: [{ area: 'ARDOUGNE', tier: 'ELITE', complete: true }]
        },
        token
      )
    );
    assert.equal(first.achievementDiary?.length, 1);

    const second = await acceptLeaguesSync(
      fakeSyncReq({ username: 'diary-user', achievementDiary: [] }, token)
    );
    assert.equal(second.achievementDiary?.length, 1);
  });
});

test('acceptLeaguesSync keeps combatAchievements when a later sync omits them', async () => {
  await withLanMode(async (token) => {
    const first = await acceptLeaguesSync(
      fakeSyncReq(
        {
          username: 'ca-user',
          combatAchievements: {
            points: 50,
            tasks: [{ task: 'ABYSSALSIRE_KILLCOUNT_1', complete: true }]
          }
        },
        token
      )
    );
    assert.equal(first.combatAchievements?.points, 50);

    const second = await acceptLeaguesSync(
      fakeSyncReq(
        { username: 'ca-user', quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }] },
        token
      )
    );
    assert.equal(second.combatAchievements?.points, 50);
    assert.equal(second.combatAchievements?.tasks.length, 1);
  });
});

test('acceptLeaguesSync serializes concurrent writes for the same player', async () => {
  await withLanMode(async (token) => {
    const [first, second] = await Promise.all([
      acceptLeaguesSync(
        fakeSyncReq(
          {
            username: 'concurrent-user',
            completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }]
          },
          token
        )
      ),
      acceptLeaguesSync(
        fakeSyncReq(
          {
            username: 'concurrent-user',
            quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }]
          },
          token
        )
      )
    ]);

    assert.ok(first.completedTasks?.length === 1 || second.completedTasks?.length === 1);
    assert.ok(first.quests?.length === 1 || second.quests?.length === 1);

    const finalState = await loadLeaguesSync('concurrent-user');
    assert.equal(finalState?.completedTasks?.length, 1);
    assert.equal(finalState?.quests?.length, 1);
  });
});

test('parseSectionSyncPayload rejects unexpected section keys', () => {
  assert.throws(
    () =>
      parseSectionSyncPayload(
        {
          username: 'a',
          quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }],
          completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }]
        },
        'quests'
      ),
    /Unexpected field: completedTasks/
  );
});

test('parseSectionSyncPayload accepts a quests-only body for the quests section', () => {
  const result = parseSectionSyncPayload(
    {
      username: 'a',
      quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }]
    },
    'quests'
  );
  assert.equal(result.quests?.length, 1);
  assert.equal(result.completedTasks, undefined);
});

test('acceptSectionSync merges only the requested section', async () => {
  await withLanMode(async (token) => {
    await acceptSectionSync(
      fakeSectionSyncReq(
        {
          username: 'section-user',
          completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }]
        },
        token
      ),
      'completedTasks'
    );

    const second = await acceptSectionSync(
      fakeSectionSyncReq(
        {
          username: 'section-user',
          quests: [{ id: 1, name: "Cook's Assistant", state: 'FINISHED' }]
        },
        token
      ),
      'quests'
    );

    assert.equal(second.completedTasks?.length, 1);
    assert.equal(second.completedTasks?.[0]?.taskId, 't1');
    assert.equal(second.quests?.length, 1);
  });
});

test('acceptSectionSync keeps completedTasks when tasks sync omits them after reinstall', async () => {
  await withLanMode(async (token) => {
    await acceptSectionSync(
      fakeSectionSyncReq(
        {
          username: 'section-empty-user',
          completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }]
        },
        token
      ),
      'completedTasks'
    );

    const second = await acceptSectionSync(
      fakeSectionSyncReq({ username: 'section-empty-user', completedTasks: [] }, token),
      'completedTasks'
    );

    assert.equal(second.completedTasks?.length, 1);
    assert.equal(second.completedTasks?.[0]?.taskId, 't1');
  });
});

test('requirePlayerDataAuth is a no-op when no auth mode is configured', async () => {
  const savedJwt = process.env.JWT_SECRET;
  const savedLan = process.env.LAN_MODE;
  delete process.env.JWT_SECRET;
  delete process.env.LAN_MODE;
  try {
    await requirePlayerDataAuth(fakeReq(undefined));
  } finally {
    if (savedJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwt;
    if (savedLan === undefined) delete process.env.LAN_MODE;
    else process.env.LAN_MODE = savedLan;
  }
});

test('assertAllowedUsername forbids names outside SYNC_ALLOWED_USERS', () => {
  const saved = process.env.SYNC_ALLOWED_USERS;
  process.env.SYNC_ALLOWED_USERS = 'zezima, other';
  const req = { auth: { scope: 'all' as const } };
  try {
    assert.doesNotThrow(() => assertAllowedUsername(req as Parameters<typeof assertAllowedUsername>[0], 'Zezima'));
    assert.throws(() => assertAllowedUsername(req as Parameters<typeof assertAllowedUsername>[0], 'not-on-list'), /Forbidden/);
  } finally {
    if (saved === undefined) delete process.env.SYNC_ALLOWED_USERS;
    else process.env.SYNC_ALLOWED_USERS = saved;
  }
});

test('JWT sync auto-claims an RSN and alts on the same accountHash', async () => {
  const usersTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-sync-jwt-test-'));
  const savedUsers = process.env.USERS_DATA_DIR;
  const savedJwt = process.env.JWT_SECRET;
  const savedLan = process.env.LAN_MODE;
  process.env.USERS_DATA_DIR = usersTmp;
  process.env.JWT_SECRET = 'sync-jwt-secret';
  delete process.env.LAN_MODE;
  try {
    const { registerUser } = await import('./users.js');
    const { mintApiToken } = await import('./auth.js');
    const user = await registerUser('sync-jwt@example.com', 'password123');
    const token = await mintApiToken(user.id);
    const hash = '123456789012345';

    await assert.rejects(
      () =>
        acceptLeaguesSync(
          fakeSyncReq({ username: 'MainRsn', completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }] }, token),
        ),
      /accountHash/,
    );

    const first = await acceptLeaguesSync(
      fakeSyncReq(
        { username: 'MainRsn', accountHash: hash, completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }] },
        token,
      ),
    );
    assert.equal(first.completedTasks?.length, 1);

    const alt = await acceptLeaguesSync(
      fakeSyncReq(
        { username: 'AltRsn', accountHash: hash, completedTasks: [{ taskId: 't2', completedAt: '2024-01-02' }] },
        token,
      ),
    );
    assert.equal(alt.username, 'altrsn');

    const other = await registerUser('other-sync-jwt@example.com', 'password123');
    const otherToken = await mintApiToken(other.id);
    await assert.rejects(
      () =>
        acceptLeaguesSync(
          fakeSyncReq(
            { username: 'Stolen', accountHash: hash, completedTasks: [{ taskId: 't3', completedAt: '2024-01-03' }] },
            otherToken,
          ),
        ),
      /Jagex account/,
    );
    await assert.rejects(
      () =>
        acceptLeaguesSync(
          fakeSyncReq(
            { username: 'MainRsn', accountHash: '999', completedTasks: [{ taskId: 't3', completedAt: '2024-01-03' }] },
            otherToken,
          ),
        ),
      /claimed by another account/,
    );
    await assert.rejects(
      () =>
        acceptLeaguesSync(
          fakeSyncReq(
            { username: 'Third', accountHash: '999', completedTasks: [{ taskId: 't3', completedAt: '2024-01-03' }] },
            token,
          ),
        ),
      /different Jagex account/,
    );
  } finally {
    await fs.rm(usersTmp, { recursive: true, force: true });
    if (savedUsers === undefined) delete process.env.USERS_DATA_DIR;
    else process.env.USERS_DATA_DIR = savedUsers;
    if (savedJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwt;
    if (savedLan === undefined) delete process.env.LAN_MODE;
    else process.env.LAN_MODE = savedLan;
  }
});

test('LAN wildcard sync ignores accountHash and does not require it', async () => {
  await withLanMode(async (token) => {
    const without = await acceptLeaguesSync(
      fakeSyncReq({ username: 'LanUser', completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }] }, token),
    );
    assert.equal(without.username, 'lanuser');
    const withHash = await acceptLeaguesSync(
      fakeSyncReq(
        { username: 'LanUser2', accountHash: '111', completedTasks: [{ taskId: 't1', completedAt: '2024-01-01' }] },
        token,
      ),
    );
    assert.equal(withHash.username, 'lanuser2');
  });
});

test('golden sync-payload.json parses as a full snapshot', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const fixturePath = fileURLToPath(new URL('./fixtures/sync-payload.json', import.meta.url));
  const body = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const parsed = parseLeaguesSyncPayload(body);
  assert.equal(parsed.username, 'testrsn');
  assert.equal(parsed.completedTasks?.length, 1);
  assert.equal(parsed.quests?.length, 1);
  assert.ok(parsed.collectionLog);
  assert.equal(parsed.achievementDiary?.length, 1);
  assert.equal(parsed.combatAchievements?.points, 100);
});
