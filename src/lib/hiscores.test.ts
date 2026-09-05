import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHiscoresCsv, combatLevel, fetchHiscores } from './hiscores.js';

function skill(name: string, level: number) {
  return { name, level, rank: null, xp: 0 };
}

// SKILLS order from hiscores.ts: 25 lines of "rank,level,xp".
const SKILL_LINES = Array.from({ length: 25 }, (_, i) => `${i + 1},${(i % 99) + 1},${i * 1000}`);

// ACTIVITY_ORDER before the bosses list (index-for-index, from hiscores.ts):
// 0 unknown, 1 League Points, ... 16 Soul Wars Zeal, ... 19 Collections Logged,
// 20 = first boss (Abyssal Sire). Everything unranked/zero is filtered from
// the response, so only the probed indices need real values.
function activityLine(index: number, probes: Record<number, string>): string {
  return probes[index] ?? '-1,-1';
}

function buildCsv(probes: Record<number, string>): string {
  const activityLines = Array.from({ length: 21 }, (_, i) => activityLine(i, probes));
  return [...SKILL_LINES, ...activityLines].join('\n');
}

test('parseHiscoresCsv parses skills in SKILLS order', () => {
  const data = parseHiscoresCsv(buildCsv({}), 'testuser');
  assert.equal(data.skills.length, 25);
  assert.equal(data.skills[0]!.name, 'Overall');
  assert.equal(data.skills[0]!.rank, 1);
  assert.equal(data.skills[0]!.level, 1);
  assert.equal(data.skills[24]!.name, 'Sailing');
  assert.equal(data.totalLevel, data.skills[0]!.level);
  assert.equal(data.totalXp, data.skills[0]!.xp);
});

// Pins the positional mapping this file's parser depends on: a Jagex
// insertion into the activity feed would silently shift every value after
// it, so this locks index 16 to Soul Wars Zeal and index 20 to the first
// boss (Abyssal Sire).
test('parseHiscoresCsv maps activity lines to the right name by position', () => {
  const data = parseHiscoresCsv(
    buildCsv({
      16: '777,4321', // Soul Wars Zeal (minigames)
      20: '50,120' // Abyssal Sire (bosses)
    }),
    'testuser'
  );

  assert.deepEqual(
    data.minigames.map((m) => m.name),
    ['Soul Wars Zeal']
  );
  assert.equal(data.minigames[0]!.rank, 777);
  assert.equal(data.minigames[0]!.score, 4321);

  assert.deepEqual(
    data.bosses.map((b) => b.name),
    ['Abyssal Sire']
  );
  assert.equal(data.bosses[0]!.rank, 50);
  assert.equal(data.bosses[0]!.score, 120);
});

test('parseHiscoresCsv throws on a too-short response', () => {
  assert.throws(() => parseHiscoresCsv('1,1,1\n1,1,1', 'testuser'), /Unexpected hiscores response format/);
});

test('combatLevel matches the real max-combat build (126)', () => {
  const skills = [99, 99, 99, 99, 99, 99, 99].map((level, i) =>
    skill(['Attack', 'Strength', 'Defence', 'Hitpoints', 'Ranged', 'Prayer', 'Magic'][i]!, level)
  );
  assert.equal(combatLevel(skills), 126);
});

test('combatLevel takes the range branch over melee when range is the higher-scoring style', () => {
  const skills = [
    skill('Attack', 1), skill('Strength', 1), skill('Defence', 1), skill('Hitpoints', 10),
    skill('Ranged', 99), skill('Prayer', 1), skill('Magic', 1)
  ];
  assert.equal(combatLevel(skills), 50);
});

test('combatLevel defaults any missing skill to level 1', () => {
  assert.equal(combatLevel([]), 1);
});

// The record is shared by every caller for the next 60s, so it must not carry
// whichever casing happened to arrive first. Every other player endpoint
// returns the normalised name; this one now does too.
test('parseHiscoresCsv reports the name it was given, and fetchHiscores gives it the storage key', () => {
  const csv = SKILL_LINES.join('\n');
  assert.equal(parseHiscoresCsv(csv, 'zezima').username, 'zezima');
  assert.equal(parseHiscoresCsv(csv, 'Some Name').username, 'Some Name');
});

// fetchHiscores' upstream branches. Jagex answers 404 for a name that has never
// been ranked, which is a normal outcome the Character page shows as "not
// found" - anything else is an outage, and must not be reported as either a
// missing player or an empty profile.
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

function stubFetch(response: () => Response): void {
  globalThis.fetch = (async () => response()) as typeof fetch;
}

test('fetchHiscores maps an unranked name to 404, and an outage to 502', async () => {
  stubFetch(() => new Response('', { status: 404 }));
  await assert.rejects(
    () => fetchHiscores('never-ranked'),
    (err: unknown) => {
      assert.equal((err as { statusCode?: number }).statusCode, 404);
      assert.match((err as Error).message, /Player not found/);
      return true;
    },
  );

  stubFetch(() => new Response('upstream is down', { status: 503 }));
  await assert.rejects(
    () => fetchHiscores('during-an-outage'),
    (err: unknown) => {
      assert.equal((err as { statusCode?: number }).statusCode, 502);
      assert.match((err as Error).message, /Hiscores lookup failed/);
      return true;
    },
  );
});

test('fetchHiscores caches per player, and normalises the name it caches under', async () => {
  let calls = 0;
  const csv = [...SKILL_LINES, '1,1'].join('\n');
  stubFetch(() => { calls++; return new Response(csv, { status: 200 }); });

  const first = await fetchHiscores('Cached Player');
  assert.equal(calls, 1);

  // Different casing, same player: served from the cache, and reported under
  // the storage key rather than whichever casing arrived first.
  const second = await fetchHiscores('CACHED PLAYER');
  assert.equal(calls, 1, 'no second upstream call');
  assert.equal(second.username, 'cached player');
  assert.equal(first.username, second.username);
});

test('fetchHiscores rejects a name that is not a valid display name', async () => {
  stubFetch(() => new Response('', { status: 200 }));
  await assert.rejects(() => fetchHiscores('../etc/passwd'), /Invalid username/);
});
