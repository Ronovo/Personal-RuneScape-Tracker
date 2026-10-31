/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, loadPage, runScript, settle, type Page, type Route } from './pageHarness.test.js';

const GUEST = { 'GET /api/auth/status': { body: { mode: 'guest', accounts: false } } };
const NOW = Math.floor(Date.now() / 1000);

const WHIP = {
  id: 4151, name: 'Abyssal whip', examine: 'A weapon from the abyss.', members: true, icon: 'https://wiki.test/whip.png',
  buyLimit: 70, highalch: 72000, lowalch: 48000, high: 1_500_000, highTime: NOW - 120, low: 1_450_000,
  lowTime: NOW - 3600, price24hAgo: 1_490_000, pctChange24h: 0.7, volume24h: 12000, buyVolume24h: 7000,
  sellVolume24h: 5000, avgHigh24h: null, avgLow24h: null, avgMargin24h: null, margin: 50000, tax: 15000,
  taxExempt: false, marginAfterTax: 35000, roi: 2.41, profitPerLimit: 2_450_000, capitalPerLimit: 101_500_000,
  highAge: 120, lowAge: 3600, stale: false, alchProfit: -1_428_000, range: '1w',
  history: [
    { timestamp: NOW - 7200, avgHighPrice: 1_510_000, avgLowPrice: 1_460_000, highPriceVolume: 10, lowPriceVolume: 12 },
    { timestamp: NOW - 3600, avgHighPrice: 1_500_000, avgLowPrice: 1_450_000, highPriceVolume: 8, lowPriceVolume: 9 },
  ],
  rangeHigh: 1_550_000, rangeLow: 1_400_000, rangeAvg: 1_480_000, pctChangeRange: -3.2, pricePosition: 42.6,
  volatility: 1.1,
};

async function open(
  search: string,
  routes: Record<string, Route> = {},
  setup: (page: Page) => void = () => {},
): Promise<Page> {
  const page = loadPage('item.html', { search, routes: { ...GUEST, ...routes } });
  setup(page);
  await runScript(page, './item.js');
  return page;
}

function itemRequests(page: Page): string[] {
  return page.requests.filter((r) => r.url.startsWith('/api/ge/item/')).map((r) => r.url);
}

function tiles(page: Page): Record<string, [string, string]> {
  return Object.fromEntries([...page.window.document.querySelectorAll('.item-stats > div:not(.stat-group)')].map((tile) => {
    const value = tile.querySelector('strong')!;
    return [tile.querySelector('.stat-label')!.textContent!.trim(), [value.textContent!, value.className]];
  }));
}

function doc(page: Page): Document {
  return page.window.document;
}

function rangeButton(page: Page, range: string): HTMLButtonElement {
  return byId(page, 'rangeToggle').querySelector<HTMLButtonElement>(`[data-range="${range}"]`)!;
}

function activeRange(page: Page): string[] {
  return [...byId(page, 'rangeToggle').querySelectorAll<HTMLButtonElement>('button.active')].map((b) => b.dataset.range!);
}

test('a page without a usable item id says so and asks for nothing', async () => {
  for (const search of ['', '?id=abc', '?id=0', '?id=-4', '?id=1.5']) {
    const page = await open(search);
    assert.equal(byId(page, 'status').textContent, 'No item specified.', search);
    assert.ok(byId(page, 'status').classList.contains('error'));
    assert.equal(byId(page, 'flipLink').hidden, true);
    assert.deepEqual(itemRequests(page), []);
  }
});

test('an item shows every price tile for the chosen range', async () => {
  const page = await open('?id=4151', { 'GET /api/ge/item/4151?range=1w': { body: WHIP } });
  assert.deepEqual(itemRequests(page), ['/api/ge/item/4151?range=1w']);
  assert.equal(page.window.document.title, 'Abyssal whip - OSRS Tracker');
  assert.equal(byId(page, 'status').textContent, '');
  assert.equal(byId(page, 'result').hidden, false);
  assert.equal(byId(page, 'chartSection').hidden, false);
  assert.equal(byId<HTMLAnchorElement>(page, 'flipLink').getAttribute('href'), 'flip.html?ids=4151');
  assert.equal(byId(page, 'flipLink').hidden, false);
  assert.deepEqual(activeRange(page), ['1w']);
  assert.equal(page.window.document.querySelector('.item-header h2 .badge')?.textContent, 'Members');
  assert.equal(page.window.document.querySelector('.examine')?.textContent, 'A weapon from the abyss.');
  assert.deepEqual(tiles(page), {
    'Insta-Buy (High)': ['1,500,000 gp', ''],
    'Insta-Sell (Low)': ['1,450,000 gp', ''],
    'Change (1W)': ['-3.2%', 'pct down'],
    'Price Position (1W)': ['43%', ''],
    'Margin (High − Low)': ['50,000 gp', ''],
    'GE Tax': ['15,000 gp', ''],
    'Margin After Tax': ['35,000 gp', ''],
    'ROI': ['+2.4%', 'pct up'],
    'Buy Limit (4h)': ['70', ''],
    'Profit at Buy Limit': ['2,450,000 gp', ''],
    'Capital for Buy Limit': ['101,500,000 gp', ''],
    'Daily Volume': ['12,000', ''],
    'Buy / Sell Volume': ['7,000 / 5,000', ''],
    'Last Insta-Buy': ['2m ago', 'up'],
    'Last Insta-Sell': ['1h ago', 'down'],
    'High Alch': ['72,000 gp', ''],
    'Low Alch': ['48,000 gp', ''],
    'Alch Profit': ['-1,428,000 gp', ''],
  });
  const tips = [...page.window.document.querySelectorAll('.stat-tip')].map((t) => t.querySelector('.stat-label')!.textContent!.trim());
  assert.deepEqual(tips, ['Change (1W)', 'Price Position (1W)']);
  assert.ok(byId(page, 'chart').querySelector('svg'));
  assert.equal(page.window.document.querySelector('#result > p.status')?.textContent, '');
});

test('missing figures read n/a, exempt items pay no tax, and stale prices are flagged', async () => {
  const quiet = {
    ...WHIP, examine: undefined, members: false, taxExempt: true, buyLimit: null, pricePosition: null,
    pctChangeRange: null, stale: true, history: undefined,
  };
  const page = await open('?id=4151', { 'GET /api/ge/item/4151?range=1w': { body: quiet } });
  const shown = tiles(page);
  assert.deepEqual(shown['GE Tax'], ['0 gp (exempt)', '']);
  assert.deepEqual(shown['Buy Limit (4h)'], ['n/a', '']);
  assert.deepEqual(shown['Price Position (1W)'], ['n/a', '']);
  assert.deepEqual(shown['Change (1W)'], ['n/a', 'pct ']);
  assert.equal(page.window.document.querySelector('.item-header .badge'), null);
  assert.equal(page.window.document.querySelector('.examine')?.textContent, '');
  assert.match(page.window.document.querySelector('#result > p.status')!.textContent!, /^Prices look stale/);
  assert.equal(byId(page, 'chart').textContent, 'No price history for this range.');
});

test('names and icons from the server cannot add markup', async () => {
  const sneaky = { ...WHIP, name: '<b>Bold</b>', examine: '<i>x</i>', icon: 'x.png" onerror="alert(1)' };
  const page = await open('?id=4151', { 'GET /api/ge/item/4151?range=1w': { body: sneaky } });
  const header = page.window.document.querySelector('.item-header')!;
  assert.equal(header.querySelector('b, i'), null);
  assert.ok(header.querySelector('h2')!.textContent!.includes('<b>Bold</b>'));
  const icon = header.querySelector('img')!;
  assert.equal(icon.getAttribute('src'), 'x.png" onerror="alert(1)');
  assert.equal(icon.hasAttribute('onerror'), false);
});

test('the range is remembered, and an unknown saved range falls back to a week', async () => {
  const month = { ...WHIP, range: '1m' };
  const page = await open('?id=4151', { 'GET /api/ge/item/4151?range=1m': { body: month } }, (p) => {
    p.window.localStorage.setItem('osrs_item_range', '1m');
  });
  assert.deepEqual(itemRequests(page), ['/api/ge/item/4151?range=1m']);
  assert.deepEqual(activeRange(page), ['1m']);
  assert.ok(tiles(page)['Change (1M)']);

  const fallback = await open('?id=4151', { 'GET /api/ge/item/4151?range=1w': { body: WHIP } }, (p) => {
    p.window.localStorage.setItem('osrs_item_range', 'forever');
  });
  assert.deepEqual(itemRequests(fallback), ['/api/ge/item/4151?range=1w']);
});

test('choosing a range saves it and loads that range', async () => {
  const page = await open('?id=4151', {
    'GET /api/ge/item/4151?range=1w': { body: WHIP },
    'GET /api/ge/item/4151?range=1y': { body: { ...WHIP, range: '1y' } },
  });
  rangeButton(page, '1y').click();
  await settle();
  assert.equal(page.window.localStorage.getItem('osrs_item_range'), '1y');
  assert.deepEqual(activeRange(page), ['1y']);
  assert.deepEqual(itemRequests(page), ['/api/ge/item/4151?range=1w', '/api/ge/item/4151?range=1y']);
  assert.ok(tiles(page)['Change (1Y)']);
});

test('a fresh copy from this tab is shown without asking again, and an old one is refetched', async () => {
  const key = 'ge_item_4151_1w';
  const cached = await open('?id=4151', {}, (p) => {
    p.window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: { ...WHIP, name: 'Cached whip' } }));
  });
  assert.deepEqual(itemRequests(cached), []);
  assert.equal(doc(cached).title, 'Cached whip - OSRS Tracker');

  const old = await open('?id=4151', { 'GET /api/ge/item/4151?range=1w': { body: WHIP } }, (p) => {
    p.window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now() - 61_000, data: { ...WHIP, name: 'Cached whip' } }));
  });
  assert.deepEqual(itemRequests(old), ['/api/ge/item/4151?range=1w']);
  assert.equal(doc(old).title, 'Abyssal whip - OSRS Tracker');
  assert.equal(JSON.parse(old.window.sessionStorage.getItem(key)!).data.name, 'Abyssal whip');

  const broken = await open('?id=4151', { 'GET /api/ge/item/4151?range=1w': { body: WHIP } }, (p) => {
    p.window.sessionStorage.setItem(key, '{not json');
  });
  assert.deepEqual(itemRequests(broken), ['/api/ge/item/4151?range=1w']);
});

test('a full browser store does not turn a good load into a failure', async () => {
  const shown = await open('?id=4151', { 'GET /api/ge/item/4151?range=1w': { body: WHIP } }, (p) => {
    p.window.Storage.prototype.setItem = () => { throw new p.window.DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  assert.equal(byId(shown, 'status').textContent, '');
  assert.equal(doc(shown).title, 'Abyssal whip - OSRS Tracker');
});

test('a failed load says why', async () => {
  const refused = await open('?id=9', { 'GET /api/ge/item/9?range=1w': { status: 404, body: { error: 'Unknown item' } } });
  assert.equal(byId(refused, 'status').textContent, 'Unknown item');
  assert.ok(byId(refused, 'status').classList.contains('error'));
  assert.equal(byId(refused, 'result').hidden, true);

  const silent = await open('?id=9', { 'GET /api/ge/item/9?range=1w': { status: 500, body: {} } });
  assert.equal(byId(silent, 'status').textContent, 'Failed to load item');

  const html = await open('?id=9', { 'GET /api/ge/item/9?range=1w': { html: '<p>proxy page</p>' } });
  assert.match(byId(html, 'status').textContent!, /^Server returned HTML instead of JSON/);
});

test('after a failed load, the next load is not shown as an error', async () => {
  let release: () => void = () => {};
  const page = await open('?id=4151', {
    'GET /api/ge/item/4151?range=1w': { status: 500, body: { error: 'Upstream down' } },
    'GET /api/ge/item/4151?range=1m': () => new Promise((resolve) => { release = () => resolve({ body: { ...WHIP, range: '1m' } }); }),
  });
  assert.ok(byId(page, 'status').classList.contains('error'));
  rangeButton(page, '1m').click();
  assert.equal(byId(page, 'status').textContent, 'Loading...');
  assert.equal(byId(page, 'status').classList.contains('error'), false, 'Loading... is drawn in the error colour');
  release();
  await settle();
});

test('an older load that answers late is ignored, whether it succeeds or fails', async () => {
  let answerWeek: (reply: { body?: unknown; html?: string }) => void = () => {};
  const page = await open('?id=4151', {
    'GET /api/ge/item/4151?range=1w': () => new Promise((resolve) => { answerWeek = resolve; }),
    'GET /api/ge/item/4151?range=3m': { body: { ...WHIP, name: 'Three month whip', range: '3m' } },
  });
  rangeButton(page, '3m').click();
  await settle();
  answerWeek({ body: { ...WHIP, name: 'Week whip' } });
  await settle();
  assert.equal(doc(page).title, 'Three month whip - OSRS Tracker');

  let failWeek: (reply: { html: string }) => void = () => {};
  const failing = await open('?id=4151', {
    'GET /api/ge/item/4151?range=1w': () => new Promise((resolve) => { failWeek = resolve; }),
    'GET /api/ge/item/4151?range=3m': { body: { ...WHIP, range: '3m' } },
  });
  rangeButton(failing, '3m').click();
  await settle();
  failWeek({ html: '<p>late</p>' });
  await settle();
  assert.equal(byId(failing, 'status').textContent, '');
  assert.equal(byId(failing, 'status').classList.contains('error'), false);
});

test('series toggles redraw the chart without asking the server again', async () => {
  const page = await open('?id=4151', { 'GET /api/ge/item/4151?range=1w': { body: WHIP } });
  const before = byId(page, 'chart').innerHTML;
  const high = page.window.document.querySelector<HTMLInputElement>('#seriesToggles [data-series="high"]')!;
  high.checked = false;
  high.dispatchEvent(new page.window.Event('change'));
  assert.notEqual(byId(page, 'chart').innerHTML, before);
  assert.equal(itemRequests(page).length, 1);

  const empty = await open('');
  empty.window.document.querySelector('#seriesToggles input')!.dispatchEvent(new empty.window.Event('change'));
  assert.equal(byId(empty, 'chart').innerHTML, '');
});
