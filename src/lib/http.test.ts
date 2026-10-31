import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedByKey, makeCacheSlot } from './http.js';

test('upstream calls name the contact a deployer sets, or the project repo', async () => {
  const realFetch = globalThis.fetch;
  const agents: (string | null)[] = [];
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    agents.push(new Headers(init?.headers).get('User-Agent'));
    return new Response('{}');
  }) as typeof fetch;
  try {
    let copy = 0;
    for (const contact of ['  ops@example.test  ', '   ', undefined]) {
      if (contact === undefined) delete process.env.WIKI_API_CONTACT;
      else process.env.WIKI_API_CONTACT = contact;
      const { fetchWithUserAgent } = (await import(`./http.js?copy=${++copy}`)) as typeof import('./http.js');
      await fetchWithUserAgent('https://prices.example.test/latest');
    }
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.WIKI_API_CONTACT;
  }
  assert.deepEqual(agents, [
    'osrs-tracker (+ops@example.test)',
    'osrs-tracker (+https://github.com/Ronovo/Personal-RuneScape-Tracker)',
    'osrs-tracker (+https://github.com/Ronovo/Personal-RuneScape-Tracker)',
  ]);
});

// Both cachedByKey and makeCacheSlot key their TTL check off Date.now(), so
// mocking it gives deterministic expiry without real sleeps. Always awaits
// fn's result before restoring Date.now - a bare try/finally around an async
// callback would restore it as soon as the callback hit its first await,
// while the callback's own assertions were still pending.
async function withMockedNow<T>(fn: (advanceMs: (ms: number) => void) => T | Promise<T>): Promise<T> {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    return await fn((ms) => {
      now += ms;
    });
  } finally {
    Date.now = realNow;
  }
}

test('makeCacheSlot returns null until set, then the cached value within the TTL', async () => {
  await withMockedNow(() => {
    const slot = makeCacheSlot<string>(1000);
    assert.equal(slot.get(), null);
    slot.set('value');
    assert.equal(slot.get(), 'value');
  });
});

test('makeCacheSlot expires the cached value once the TTL has elapsed', async () => {
  await withMockedNow((advanceMs) => {
    const slot = makeCacheSlot<string>(1000);
    slot.set('value');
    advanceMs(999);
    assert.equal(slot.get(), 'value');
    advanceMs(2);
    assert.equal(slot.get(), null);
  });
});

test('cachedByKey only calls the fetcher once while the entry is still fresh', async () => {
  await withMockedNow(async () => {
    const store = new Map<string, { at: number; data: number }>();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls;
    };

    const first = await cachedByKey(store, 'k', 1000, fetcher);
    const second = await cachedByKey(store, 'k', 1000, fetcher);
    assert.equal(first, 1);
    assert.equal(second, 1);
    assert.equal(calls, 1);
  });
});

test('cachedByKey refetches once the entry is older than its TTL', async () => {
  await withMockedNow(async (advanceMs) => {
    const store = new Map<string, { at: number; data: number }>();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return calls;
    };

    assert.equal(await cachedByKey(store, 'k', 1000, fetcher), 1);
    advanceMs(1001);
    assert.equal(await cachedByKey(store, 'k', 1000, fetcher), 2);
    assert.equal(calls, 2);
  });
});

test('cachedByKey keeps separate entries per key', async () => {
  await withMockedNow(async () => {
    const store = new Map<string, { at: number; data: string }>();
    const first = await cachedByKey(store, 'a', 1000, async () => 'value-a');
    const second = await cachedByKey(store, 'b', 1000, async () => 'value-b');
    assert.equal(first, 'value-a');
    assert.equal(second, 'value-b');
  });
});
