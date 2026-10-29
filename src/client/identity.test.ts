/// <reference types="node" />
// node:test runs this against the compiled output, so localStorage and fetch are stubbed below.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
const requests: string[] = [];
let reply = { status: 200, body: {} as unknown };

Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
  fetch: async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
});

const { getBankroll, setBankroll } = await import('./identity.js');
const { fetchJson, UNAUTHORIZED_HINT } = await import('./format.js');

function savedAt(): string | undefined {
  return [...store.entries()].find(([key]) => key.startsWith('osrs_bankroll_saved_at'))?.[1];
}

test('saving the same bankroll again keeps its old timestamp', async () => {
  setBankroll(5000);
  const first = savedAt();
  assert.ok(first);
  await new Promise((resolve) => setTimeout(resolve, 5));
  setBankroll(5000);
  assert.equal(savedAt(), first);
  assert.equal(getBankroll(), 5000);
});

test('a changed bankroll gets a new timestamp', async () => {
  setBankroll(5000);
  const first = savedAt();
  await new Promise((resolve) => setTimeout(resolve, 5));
  setBankroll(6000);
  assert.notEqual(savedAt(), first);
});

test('a 401 with its own reason keeps it; a bare one gets the sign-in hint', async () => {
  reply = { status: 401, body: { error: 'Invalid username or password' } };
  assert.equal((await fetchJson<{ error: string }>('/api/auth/login')).data.error, 'Invalid username or password');
  reply = { status: 401, body: { error: 'Unauthorized' } };
  assert.equal((await fetchJson<{ error: string }>('/api/watchlist/x')).data.error, UNAUTHORIZED_HINT);
});
