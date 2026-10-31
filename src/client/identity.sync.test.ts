/// <reference types="node" />
// node:test runs this against the compiled output. localStorage and fetch are stubbed, with an account token saved
// and the server in public mode, so bankrolls sync with the account.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
const posted: unknown[] = [];
let blockStorage = false;
let bankrollsReply: () => Response;
let watchlistReply: () => Response;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => {
      if (blockStorage) throw new Error('Storage is blocked');
      return [...store.keys()][i] ?? null;
    },
    get length() {
      return store.size;
    },
  },
  fetch: async (url: string, init: RequestInit = {}) => {
    if (url === '/api/auth/status') return json(200, { mode: 'public', accounts: true });
    if (url.startsWith('/api/watchlist/')) return watchlistReply();
    posted.push(JSON.parse(init.body as string));
    return bankrollsReply();
  },
});

const {
  getBankroll, getWatchlist, loadWatchlist, setBankroll, setUsername, syncBankrolls, toggleWatchlist,
} = await import('./identity.js');

beforeEach(() => {
  store.clear();
  store.set('osrs_api_token', 'account-token');
  posted.length = 0;
  blockStorage = false;
  bankrollsReply = () => json(200, { bankrolls: {} });
  watchlistReply = () => json(200, { itemIds: [] });
});

test('only real local amounts are sent to the account', async () => {
  store.set('osrs_bankroll::_guest_', '7000');
  store.set('osrs_bankroll_saved_at::_guest_', '123');
  store.set('osrs_bankroll::Zezima', 'lots');
  store.set('osrs_bankroll::Lynx', '-5');
  store.set('osrs_bankroll::Woox', '2500');
  assert.equal(await syncBankrolls(), false);
  assert.deepEqual(posted, [{ bankrolls: { _guest_: { value: 7000, savedAt: 123 }, Woox: { value: 2500, savedAt: 0 } } }]);
});

test('a newer amount from the account replaces the local one', async () => {
  store.set('osrs_bankroll::_guest_', '7000');
  bankrollsReply = () => json(200, { bankrolls: { _guest_: { value: 9000, savedAt: 456 }, Woox: { value: 7000, savedAt: 1 } } });
  assert.equal(await syncBankrolls(), true);
  assert.equal(store.get('osrs_bankroll::_guest_'), '9000');
  assert.equal(store.get('osrs_bankroll_saved_at::_guest_'), '456');
  assert.equal(store.get('osrs_bankroll::Woox'), '7000');
});

test('a refused, empty or unreachable sync changes nothing', async () => {
  store.set('osrs_bankroll::_guest_', '7000');
  for (const reply of [() => json(401, { error: 'Unauthorized' }), () => json(200, {}), () => { throw new Error('offline'); }]) {
    bankrollsReply = reply;
    assert.equal(await syncBankrolls(), false);
    assert.equal(store.get('osrs_bankroll::_guest_'), '7000');
  }
});

test('blocked storage sends nothing local', async () => {
  store.set('osrs_bankroll::_guest_', '7000');
  blockStorage = true;
  await syncBankrolls();
  assert.deepEqual(posted, [{ bankrolls: {} }]);
});

test('a bankroll that is not a real amount is not saved', () => {
  setBankroll(4000);
  assert.equal(setBankroll(-5), 4000);
  assert.equal(setBankroll(Number.NaN), 4000);
  assert.equal(getBankroll(), 4000);
});

test('a blank name is not played as', () => {
  setUsername('   ');
  assert.equal(store.get('osrs_current_user'), undefined);
});

test('an unreachable watchlist keeps the list already loaded for that name', async () => {
  store.set('osrs_current_user', 'Zezima');
  watchlistReply = () => json(200, { itemIds: [4151] });
  assert.deepEqual(await loadWatchlist(), [4151]);
  watchlistReply = () => { throw new Error('offline'); };
  assert.deepEqual(await loadWatchlist(), [4151]);
});

test('a star whose save is refused, with nobody listening for the failure, stays starred here', async () => {
  store.set('osrs_current_user', 'Zezima');
  await loadWatchlist();
  watchlistReply = () => json(403, { error: 'Not your name' });
  assert.deepEqual(toggleWatchlist(4151), [4151]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(getWatchlist(), [4151]);
});
