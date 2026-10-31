/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle, type Page, type Reply, type Route } from './pageHarness.test.js';

const GUEST = { 'GET /api/auth/status': { body: { mode: 'guest', accounts: false } } };
const DESC = '↓ High to low';
const ASC = '↑ Low to high';
const DOT = '·';

// Timers of a second or more (Set as Default arming, column status messages, the Return to item highlight) wait
// for passTime() instead of the clock. Bare setTimeout and window.setTimeout share them, as they do in a browser.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const held = new Map<number, () => void>();
let heldId = 1_000_000;
const holdingSetTimeout = ((fn: () => void, ms = 0) => {
  if (ms < 1000) return realSetTimeout(fn, ms);
  held.set(++heldId, fn);
  return heldId;
}) as unknown as typeof setTimeout;
const holdingClearTimeout = ((id: number) => {
  if (!held.delete(id)) realClearTimeout(id);
}) as unknown as typeof clearTimeout;
globalThis.setTimeout = holdingSetTimeout;
globalThis.clearTimeout = holdingClearTimeout;

function passTime(): void {
  const due = [...held.values()];
  held.clear();
  due.forEach((fn) => fn());
}

function item(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, members: false, icon: `https://wiki.test/${id}.png`, buy: 1000, sell: 1200, margin: 200, tax: 24,
    taxExempt: false, profit: 176, roi: 17.6, limit: 100, profitPerLimit: 17600, capital: 100000, volume24h: 50000,
    buyPressure: null, age: 60, highTime: null, lowTime: null, marginVsAvg: 1.2, gpPerHour: 5000, score: 70,
    confidence: 'high', confidenceWhy: 'Fresh trades on both sides', realisticProfit: 52800, ...extra,
  };
}

const ITEMS = [item(1, 'Rune bar'), item(2, 'Dragon bones', { buy: 2000, sell: 2300 })];

function result(items: unknown[] = ITEMS, page = 1, totalPages = 1) {
  return { items, consideredCount: items.length, page, pageSize: 50, totalPages };
}

const DEFAULT_QUERY = {
  sort: 'profitPerLimit', sortDir: 'desc', pageSize: '50', page: '1', minVolume: '1000', minPrice: '50',
  minMargin: '0', minRoi: '0', membersOnly: 'all',
};
const IDS_QUERY = { sort: 'profitPerLimit', sortDir: 'desc', pageSize: '50', page: '1' };

async function open(
  { routes = {}, storage = {}, search = '' }:
    { routes?: Record<string, Route>; storage?: Record<string, string>; search?: string } = {},
): Promise<Page> {
  held.clear();
  const page = loadPage('flip.html', {
    routes: { ...GUEST, 'GET /api/ge/flips': { body: result() }, ...routes }, storage, search,
  });
  page.window.setTimeout = holdingSetTimeout as never;
  page.window.clearTimeout = holdingClearTimeout as never;
  page.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
    this.dataset.scrolled = String(Number(this.dataset.scrolled ?? 0) + 1);
  };
  await runScript(page, './flip.js');
  return page;
}

function queries(page: Page): Record<string, string>[] {
  return page.requests.filter((r) => r.url.split('?')[0] === '/api/ge/flips')
    .map((r) => Object.fromEntries(new URLSearchParams(r.url.split('?')[1])));
}

function lastQuery(page: Page): Record<string, string> {
  const all = queries(page);
  return all[all.length - 1]!;
}

function $(page: Page, selector: string): HTMLElement {
  const found = page.window.document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`${selector} is not on the page`);
  return found;
}

function press(page: Page, selector: string): void {
  $(page, selector).dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
}

async function pressAndSettle(page: Page, selector: string): Promise<void> {
  press(page, selector);
  await settle();
}

function rowIds(page: Page): string[] {
  return [...page.window.document.querySelectorAll<HTMLElement>('#flipBody tr[data-item-id]')].map((r) => r.dataset.itemId!);
}

function headers(page: Page): string[] {
  return [...page.window.document.querySelectorAll<HTMLElement>('#flipTable th[data-col]')].map((th) => th.dataset.col!);
}

function checkedColumns(page: Page): string[] {
  return [...page.window.document.querySelectorAll<HTMLInputElement>('#columnsPanel input[type="checkbox"]')]
    .filter((cb) => cb.checked).map((cb) => cb.dataset.col!);
}

function activePresets(page: Page): string[] {
  return [...page.window.document.querySelectorAll<HTMLElement>('#presetToolbar button[data-preset].active')]
    .map((b) => b.dataset.preset!);
}

function fill(page: Page, values: Record<string, string>): void {
  for (const [id, value] of Object.entries(values)) byId<HTMLInputElement>(page, id).value = value;
}

function typeInto(page: Page, values: Record<string, string>): void {
  for (const [id, value] of Object.entries(values)) {
    byId<HTMLInputElement>(page, id).value = value;
    byId(page, id).dispatchEvent(new page.window.Event('input'));
  }
}

async function choose(page: Page, id: string, value: string): Promise<void> {
  byId<HTMLSelectElement>(page, id).value = value;
  byId(page, id).dispatchEvent(new page.window.Event('change', { bubbles: true }));
  await settle();
}

async function setColumn(page: Page, key: string, on: boolean): Promise<void> {
  const box = $(page, `#columnsPanel input[data-col="${key}"]`) as HTMLInputElement;
  box.checked = on;
  box.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  await settle();
}

function calc(page: Page): Record<string, string | null> {
  return Object.fromEntries(['calcTax', 'calcProfit', 'calcRoi', 'calcCapital'].map((id) => [id, byId(page, id).textContent]));
}

test('the page opens with the default scan, the factory columns and an empty calculator', async () => {
  const page = await open();
  assert.deepEqual(queries(page), [DEFAULT_QUERY]);
  assert.equal(byId(page, 'resultsTitle').textContent, 'All flips');
  assert.equal(byId(page, 'status').textContent, '');
  assert.deepEqual(rowIds(page), ['1', '2']);
  assert.equal(page.window.document.querySelectorAll('#flipCards .flip-card').length, 2);
  assert.deepEqual(headers(page), ['buy', 'sell', 'margin', 'profit', 'roi', 'volume']);
  assert.deepEqual(checkedColumns(page), headers(page));
  assert.equal(byId(page, 'pageIndicator').textContent, 'Page 1 of 1');
  assert.equal(byId<HTMLButtonElement>(page, 'pagePrev').disabled, true);
  assert.equal(byId<HTMLButtonElement>(page, 'pageNext').disabled, true);
  assert.deepEqual(calc(page), { calcTax: 'n/a', calcProfit: 'n/a', calcRoi: 'n/a', calcCapital: 'n/a' });
  assert.equal(byId(page, 'backToGe').hidden, true);
  assert.equal(byId(page, 'sortDirBtn').textContent, DESC);
  const cardLabels = [...$(page, '#flipCards .flip-card').querySelectorAll('dt')].map((dt) => dt.textContent);
  assert.equal(cardLabels.includes('Realistic'), false);
  assert.deepEqual(JSON.parse(page.window.localStorage.getItem('osrs_flip_filters')!), {
    minVolume: '1000', minPrice: '50', maxPrice: '', minMargin: '0', minRoi: '0', minMarginVsAvg: '',
    maxAgeMinutes: '', membersOnly: 'all', pageSize: '50', sort: 'profitPerLimit', sortDir: 'desc',
  });
});

test('a row links to its item and its buttons carry the item, with names escaped', async () => {
  const odd = item(3, '<b>Odd</b>', { icon: 'x.png" onerror="y', taxExempt: true });
  const page = await open({ routes: { 'GET /api/ge/flips': { body: result([odd]) } } });
  const row = $(page, '#flipBody tr');
  assert.equal(row.querySelector('b'), null);
  assert.equal(row.querySelector('.item-link')!.getAttribute('href'), 'item.html?id=3');
  assert.equal(row.querySelector('.item-link')!.textContent!.trim(), '<b>Odd</b>');
  assert.equal(row.querySelector('img')!.hasAttribute('onerror'), false);
  assert.deepEqual({ ...row.querySelector<HTMLElement>('.calc-btn')!.dataset },
    { id: '3', name: '<b>Odd</b>', buy: '1000', sell: '1200', taxExempt: 'true' });
  const card = $(page, '#flipCards .flip-card');
  assert.equal(card.dataset.itemId, '3');
  assert.equal(card.querySelector('.conf-dot')!.getAttribute('title'), 'Fresh trades on both sides');
});

test('the drawer is read on Scan, blanks are left out, and a bankroll adds Realistic to the cards', async () => {
  const page = await open();
  fill(page, { minVolume: '', minPrice: '', minMargin: '', minRoi: '', maxPrice: '5000', minMarginVsAvg: '1.5',
    maxAgeMinutes: '20', bankroll: '2000000', flipSearch: ' rune ' });
  byId<HTMLSelectElement>(page, 'membersOnly').value = 'members';
  assert.equal(queries(page).length, 1);

  click(page, 'scanBtn');
  await settle();
  assert.deepEqual(lastQuery(page), {
    ...DEFAULT_QUERY, bankroll: '2000000', minVolume: '0', minPrice: '0', minMargin: '0', minRoi: '0',
    maxPrice: '5000', minMarginVsAvg: '1.5', maxAgeMinutes: '20', membersOnly: 'members', name: 'rune',
  });
  assert.equal(page.window.localStorage.getItem('osrs_bankroll::_guest_'), '2000000');
  const cardLabels = [...$(page, '#flipCards .flip-card').querySelectorAll('dt')].map((dt) => dt.textContent);
  assert.ok(cardLabels.includes('Realistic'));
});

test('typing in the search box rescans after a pause', async () => {
  const page = await open();
  typeInto(page, { flipSearch: 'bar' });
  assert.equal(queries(page).length, 1);
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settle();
  assert.equal(lastQuery(page).name, 'bar');
});

test('a preset writes its filters, keeps the Members choice and names the scan', async () => {
  const page = await open();
  click(page, 'f2pFilterBtn');
  await settle();
  assert.equal(lastQuery(page).membersOnly, 'f2p');
  assert.equal(byId(page, 'resultsTitle').textContent, 'All flips F2P');

  await pressAndSettle(page, '[data-preset="penny"]');
  assert.deepEqual(lastQuery(page), {
    ...DEFAULT_QUERY, sort: 'gpPerHour', maxPrice: '1000', minVolume: '100000', membersOnly: 'f2p',
  });
  assert.deepEqual(activePresets(page), ['penny']);
  assert.equal(byId(page, 'resultsTitle').textContent, `Penny Arcade Cheap, fast trades ${DOT} F2P`);
  assert.equal(byId<HTMLInputElement>(page, 'maxPrice').value, '1000');
  assert.equal(byId<HTMLSelectElement>(page, 'flipSort').value, 'gpPerHour');

  click(page, 'scanBtn');
  await settle();
  assert.deepEqual(activePresets(page), []);
  assert.equal(byId(page, 'resultsTitle').textContent, 'All flips F2P');
  assert.equal(lastQuery(page).maxPrice, '1000');
});

test('Fits My Bankroll caps the capital at the bankroll and stays on through a Scan', async () => {
  const page = await open({ storage: { 'osrs_bankroll::_guest_': '750000' } });
  assert.equal(byId<HTMLInputElement>(page, 'bankroll').value, '750000');
  await pressAndSettle(page, '[data-preset="bankroll"]');
  assert.deepEqual(lastQuery(page), { ...DEFAULT_QUERY, sort: 'realisticProfit', bankroll: '750000', maxCapital: '750000' });

  click(page, 'scanBtn');
  await settle();
  assert.deepEqual(activePresets(page), ['bankroll']);
  assert.equal(lastQuery(page).maxCapital, '750000');

  fill(page, { bankroll: '' });
  click(page, 'scanBtn');
  await settle();
  assert.equal(lastQuery(page).bankroll, undefined);
  assert.equal(lastQuery(page).maxCapital, undefined);
});

test('stars pin items to the watchlist, which scans just those items', async () => {
  const page = await open();
  await pressAndSettle(page, '[data-preset="watchlist"]');
  assert.equal(queries(page).length, 1);
  assert.equal(byId(page, 'flipBody').textContent, 'Watchlist is empty. Star items to pin them here.');
  assert.equal($(page, '#flipBody td').getAttribute('colspan'), '8');
  assert.equal(byId(page, 'flipCards').textContent, 'Watchlist is empty. Star items to pin them here.');
  assert.equal(byId(page, 'resultsTitle').textContent, '★ Watchlist Your starred items');

  await pressAndSettle(page, '[data-preset="composite"]');
  await pressAndSettle(page, '#flipBody tr[data-item-id="1"] .star-btn');
  const stars = [...page.window.document.querySelectorAll('.star-btn[data-id="1"]')];
  assert.equal(stars.length, 2);
  assert.ok(stars.every((s) => s.classList.contains('on')));
  assert.equal(page.window.localStorage.getItem('osrs_flip_watchlist::_guest_'), '[1]');
  const scans = queries(page).length;

  await pressAndSettle(page, '[data-preset="watchlist"]');
  assert.equal(queries(page).length, scans + 1);
  assert.deepEqual(lastQuery(page), { ...IDS_QUERY, ids: '1' });
  await pressAndSettle(page, '#flipCards [data-item-id="1"] .star-btn');
  assert.equal(byId(page, 'flipBody').textContent, 'Watchlist is empty. Star items to pin them here.');
});

test('a signed-in name keeps its stars on the server, and a refused save says why', async () => {
  const page = await open({
    storage: { osrs_current_user: 'Zezima' },
    routes: {
      'GET /api/watchlist/Zezima': { body: { itemIds: [2] } },
      'PUT /api/watchlist/Zezima': { status: 401, body: {} },
    },
  });
  assert.ok($(page, '#flipBody .star-btn[data-id="2"]').classList.contains('on'));
  await pressAndSettle(page, '#flipBody .star-btn[data-id="1"]');
  assert.deepEqual(page.requests.filter((r) => r.method === 'PUT').map((r) => r.body), [{ itemIds: [1, 2] }]);
  assert.equal(byId(page, 'status').textContent, 'Your watchlist was not saved. Sign in again to keep it.');
  assert.ok(byId(page, 'status').classList.contains('error'));

  page.routes['PUT /api/watchlist/Zezima'] = { status: 500, body: {} };
  await pressAndSettle(page, '#flipBody .star-btn[data-id="1"]');
  assert.equal(byId(page, 'status').textContent, 'Your watchlist was not saved.');

  page.routes['PUT /api/watchlist/Zezima'] = () => { throw new Error('offline'); };
  await pressAndSettle(page, '#flipBody .star-btn[data-id="1"]');
  assert.equal(byId(page, 'status').textContent, 'Your watchlist was not saved: the server could not be reached.');
});

test('switching who is played as swaps in that name\'s bankroll and watchlist', async () => {
  const page = await open({
    storage: { 'osrs_bankroll::Zezima': '50000' },
    routes: { 'GET /api/watchlist/Zezima': { body: { itemIds: [1] } }, 'GET /api/watchlist/Lynx': { body: {} } },
  });
  page.window.localStorage.setItem('osrs_current_user', 'Zezima');
  page.window.dispatchEvent(new page.window.Event('osrs-session-change'));
  await settle();
  assert.equal(byId<HTMLInputElement>(page, 'bankroll').value, '50000');
  assert.equal(lastQuery(page).bankroll, '50000');
  assert.ok($(page, '#flipBody .star-btn[data-id="1"]').classList.contains('on'));

  page.window.localStorage.setItem('osrs_current_user', 'Lynx');
  page.window.dispatchEvent(new page.window.Event('osrs-session-change'));
  await settle();
  assert.equal(byId<HTMLInputElement>(page, 'bankroll').value, '');
  assert.equal(page.window.document.querySelectorAll('.star-btn.on').length, 0);
});

test('switching to a name whose watchlist cannot be read does not show the last name\'s stars', async () => {
  const page = await open({
    storage: { osrs_current_user: 'Zezima' },
    routes: { 'GET /api/watchlist/Zezima': { body: { itemIds: [1, 2] } } },
  });
  assert.equal(page.window.document.querySelectorAll('#flipBody .star-btn.on').length, 2);
  page.routes['GET /api/watchlist/Lynx'] = { status: 403, body: { error: 'That name belongs to another account' } };
  page.window.localStorage.setItem('osrs_current_user', 'Lynx');
  page.window.dispatchEvent(new page.window.Event('osrs-session-change'));
  await settle();
  assert.equal(page.window.document.querySelectorAll('#flipBody .star-btn.on').length, 0);
});

test('a header, the sort box or the direction button re-sorts', async () => {
  const page = await open();
  await pressAndSettle(page, '#flipTable th[data-col="roi"]');
  assert.deepEqual([lastQuery(page).sort, lastQuery(page).sortDir], ['roi', 'desc']);
  assert.equal($(page, '#flipTable th[data-col="roi"]').className, 'sort-active sort-desc');
  await pressAndSettle(page, '#flipTable th[data-col="roi"]');
  assert.equal(lastQuery(page).sortDir, 'asc');
  assert.equal($(page, '#flipTable th[data-col="roi"]').className, 'sort-active sort-asc');
  assert.equal(byId(page, 'sortDirBtn').textContent, ASC);

  await pressAndSettle(page, '#flipTable th[data-sort="name"]');
  assert.deepEqual([lastQuery(page).sort, lastQuery(page).sortDir], ['name', 'asc']);
  const scans = queries(page).length;
  await pressAndSettle(page, '#flipTable th:not([data-sort])');
  assert.equal(queries(page).length, scans);

  await choose(page, 'flipSort', 'volume');
  assert.deepEqual([lastQuery(page).sort, lastQuery(page).sortDir], ['volume', 'desc']);
  click(page, 'sortDirBtn');
  await settle();
  assert.equal(lastQuery(page).sortDir, 'asc');
});

test('paging moves through the results and stops at either end', async () => {
  const page = await open({
    routes: {
      'GET /api/ge/flips': (_body, url) => ({ body: result(ITEMS, Number(url.searchParams.get('page')), 3) }),
    },
  });
  const prev = byId<HTMLButtonElement>(page, 'pagePrev');
  const next = byId<HTMLButtonElement>(page, 'pageNext');
  assert.deepEqual([prev.disabled, next.disabled], [true, false]);
  click(page, 'pageNext');
  await settle();
  assert.equal(byId(page, 'pageIndicator').textContent, 'Page 2 of 3');
  assert.deepEqual([prev.disabled, next.disabled], [false, false]);
  click(page, 'pageNext');
  await settle();
  assert.deepEqual([lastQuery(page).page, String(next.disabled)], ['3', 'true']);

  const scans = queries(page).length;
  next.disabled = false;
  click(page, 'pageNext');
  await settle();
  assert.equal(queries(page).length, scans);

  click(page, 'pagePrev');
  await settle();
  assert.equal(lastQuery(page).page, '2');
  await choose(page, 'pageSize', '25');
  assert.deepEqual([lastQuery(page).page, lastQuery(page).pageSize], ['1', '25']);
  prev.disabled = false;
  click(page, 'pagePrev');
  await settle();
  assert.equal(queries(page).length, scans + 2);
});

test('columns are shown and hidden from memory, and Set as Default needs a second click', async () => {
  const page = await open();
  const panel = byId(page, 'columnsPanel');
  click(page, 'columnsBtn');
  assert.equal(panel.hidden, false);
  click(page, 'columnsBtn');
  assert.equal(panel.hidden, true);

  await setColumn(page, 'buy', false);
  await setColumn(page, 'score', true);
  assert.deepEqual(headers(page), ['sell', 'margin', 'profit', 'roi', 'volume', 'score']);
  assert.equal($(page, '#flipBody tr').querySelectorAll('td').length, 8);
  panel.dispatchEvent(new page.window.Event('change'));
  assert.equal(queries(page).length, 1);

  const setDefault = byId(page, 'setDefaultBtn');
  const status = byId(page, 'columnsDefaultStatus');
  click(page, 'setDefaultBtn');
  assert.equal(setDefault.textContent, 'Click again to confirm');
  assert.equal(status.textContent, 'Save these 6 column(s) as your default?');
  passTime();
  assert.equal(setDefault.textContent, 'Set as Default');
  assert.equal(status.textContent, '');

  click(page, 'setDefaultBtn');
  click(page, 'setDefaultBtn');
  assert.equal(setDefault.textContent, 'Set as Default');
  assert.equal(status.textContent, 'Saved - this column set now loads by default.');
  assert.deepEqual(JSON.parse(page.window.localStorage.getItem('osrs_flip_default_columns')!),
    ['sell', 'margin', 'profit', 'roi', 'volume', 'score']);
  passTime();
  assert.equal(status.textContent, '');

  const reopened = await open({ storage: { osrs_flip_default_columns: JSON.stringify(['score', 'bogus']) } });
  assert.deepEqual(headers(reopened), ['score']);
  click(reopened, 'setDefaultBtn');
  click(reopened, 'resetDefaultBtn');
  assert.equal(byId(reopened, 'setDefaultBtn').textContent, 'Set as Default');
  assert.equal(byId(reopened, 'columnsDefaultStatus').textContent, 'Reset to the factory default columns.');
  assert.equal(reopened.window.localStorage.getItem('osrs_flip_default_columns'), null);
  assert.deepEqual(headers(reopened), ['buy', 'sell', 'margin', 'profit', 'roi', 'volume']);

  const junk = await open({ storage: { osrs_flip_default_columns: JSON.stringify(['bogus']) } });
  assert.deepEqual(headers(junk), ['buy', 'sell', 'margin', 'profit', 'roi', 'volume']);
});

test('the Realistic column follows the bankroll, header and cells together', async () => {
  const page = await open();
  const widths = () => ({
    headers: page.window.document.querySelectorAll('#flipTable thead th').length,
    cells: $(page, '#flipBody tr').querySelectorAll('td').length,
  });
  await setColumn(page, 'realisticProfit', true);
  assert.equal(headers(page).includes('realisticProfit'), false);

  for (const [bankroll, shown] of [['1000000', true], ['', false]] as const) {
    fill(page, { bankroll });
    click(page, 'scanBtn');
    await settle();
    const { headers: headerCount, cells } = widths();
    assert.equal(headerCount, cells, `bankroll "${bankroll}": header cells against row cells`);
    assert.equal(headers(page).includes('realisticProfit'), shown, `bankroll "${bankroll}"`);
  }
});

test('the calculator works out tax, profit, ROI and capital for any quantity', async () => {
  const page = await open();
  typeInto(page, { calcBuy: '1000', calcSell: '1200', calcQty: '3' });
  assert.deepEqual(calc(page), { calcTax: '72 gp', calcProfit: '528 gp', calcRoi: '+17.6%', calcCapital: '3,000 gp' });
  for (const qty of ['', '-4']) {
    typeInto(page, { calcQty: qty });
    assert.deepEqual(calc(page), { calcTax: '24 gp', calcProfit: '176 gp', calcRoi: '+17.6%', calcCapital: '1,000 gp' });
  }
  typeInto(page, { calcSell: '' });
  assert.deepEqual(calc(page), { calcTax: 'n/a', calcProfit: 'n/a', calcRoi: 'n/a', calcCapital: 'n/a' });
});

test('the calculator button copies the item in and keeps its tax exemption while editing', async () => {
  const bond = item(5, 'Old school bond', { buy: 10_000_000, sell: 10_500_000, taxExempt: true });
  const page = await open({ routes: { 'GET /api/ge/flips': { body: result([item(1, 'Rune bar'), bond, item(6, '')]) } } });
  await pressAndSettle(page, '#flipBody .calc-btn[data-id="5"]');
  assert.equal(byId<HTMLInputElement>(page, 'calcBuy').value, '10000000');
  assert.equal(byId<HTMLInputElement>(page, 'calcSell').value, '10500000');
  assert.equal(byId(page, 'calcSelectedLabel').textContent, ' - Old school bond');
  assert.equal(calc(page).calcTax, '0 gp');
  assert.equal(calc(page).calcProfit, '500,000 gp');
  assert.equal(byId(page, 'returnToItemBtn').hidden, false);
  assert.equal(byId(page, 'calcHeading').dataset.scrolled, '1');

  typeInto(page, { calcSell: '11000000' });
  assert.equal(calc(page).calcTax, '0 gp');
  await pressAndSettle(page, '#flipCards .calc-btn[data-id="1"]');
  assert.equal(calc(page).calcTax, '24 gp');
  await pressAndSettle(page, '#flipBody .calc-btn[data-id="6"]');
  assert.equal(byId(page, 'calcSelectedLabel').textContent, '');

  await pressAndSettle(page, '#flipBody tr td');
  assert.equal(byId<HTMLInputElement>(page, 'calcBuy').value, '1000');
});

test('Return to item brings back the result view the item came from and highlights it', async () => {
  const page = await open({
    routes: {
      'GET /api/ge/flips': (_body, url) => {
        const n = Number(url.searchParams.get('page'));
        return { body: result(n === 2 ? [item(7, 'Page two item')] : ITEMS, n, 2) };
      },
    },
  });
  click(page, 'pageNext');
  await settle();
  await pressAndSettle(page, '#flipBody .calc-btn[data-id="7"]');
  fill(page, { minVolume: '99999', flipSearch: 'rune' });
  click(page, 'scanBtn');
  await settle();
  assert.deepEqual(rowIds(page), ['1', '2']);

  const returnBtn = byId<HTMLButtonElement>(page, 'returnToItemBtn');
  click(page, 'returnToItemBtn');
  assert.equal(returnBtn.disabled, true);
  await settle();
  assert.equal(returnBtn.disabled, false);
  assert.deepEqual(lastQuery(page), { ...DEFAULT_QUERY, page: '2' });
  assert.equal(byId<HTMLInputElement>(page, 'minVolume').value, '1000');
  assert.equal(byId<HTMLInputElement>(page, 'flipSearch').value, '');
  const row = $(page, '#flipBody tr[data-item-id="7"]');
  assert.ok(row.classList.contains('return-target'));
  assert.equal(row.dataset.scrolled, '1');
  passTime();
  assert.equal(row.classList.contains('return-target'), false);
});

test('Return to item says so when the item has gone, and stops when the scan fails', async () => {
  let items = ITEMS;
  const page = await open({ routes: { 'GET /api/ge/flips': () => ({ body: result(items) }) } });
  await pressAndSettle(page, '#flipBody .calc-btn[data-id="2"]');
  items = [item(1, 'Rune bar')];
  click(page, 'returnToItemBtn');
  await settle();
  assert.equal(byId(page, 'status').textContent, 'The selected item is no longer available in its original result view.');
  assert.ok(byId(page, 'status').classList.contains('error'));

  page.routes['GET /api/ge/flips'] = { status: 503, body: { error: 'Scanner busy' } };
  click(page, 'returnToItemBtn');
  await settle();
  assert.equal(byId(page, 'status').textContent, 'Scanner busy');
  assert.equal(byId<HTMLButtonElement>(page, 'returnToItemBtn').disabled, false);
});

test('Return to item goes back to the items a GE link asked for', async () => {
  const page = await open({ search: '?ids=1,2' });
  await pressAndSettle(page, '#flipBody .calc-btn[data-id="2"]');
  click(page, 'scanBtn');
  await settle();
  assert.deepEqual(lastQuery(page), DEFAULT_QUERY);
  click(page, 'returnToItemBtn');
  await settle();
  assert.deepEqual(lastQuery(page), { ...IDS_QUERY, ids: '1,2' });
  assert.ok($(page, '#flipBody tr[data-item-id="2"]').classList.contains('return-target'));
});

test('a GE Flip link scans just that item, opens it in the calculator and offers a way back', async () => {
  const page = await open({ search: '?ids=2&from=ge' });
  assert.deepEqual(lastQuery(page), { ...IDS_QUERY, ids: '2' });
  assert.equal(byId<HTMLInputElement>(page, 'calcBuy').value, '2000');
  assert.equal(byId(page, 'calcSelectedLabel').textContent, ' - Dragon bones');
  assert.equal(byId(page, 'backToGe').hidden, false);
  click(page, 'scanBtn');
  await settle();
  assert.deepEqual(lastQuery(page), DEFAULT_QUERY);
});

test('a link with several ids, an unknown id or none usable leaves the calculator alone', async () => {
  const several = await open({ search: '?ids=1,2' });
  assert.deepEqual(lastQuery(several), { ...IDS_QUERY, ids: '1,2' });
  assert.equal(byId<HTMLInputElement>(several, 'calcBuy').value, '');
  assert.equal(byId(several, 'backToGe').hidden, true);

  const unknown = await open({ search: '?ids=9' });
  assert.equal(byId<HTMLInputElement>(unknown, 'calcBuy').value, '');

  const unusable = await open({ search: '?ids=abc' });
  assert.deepEqual(lastQuery(unusable), DEFAULT_QUERY);
});

test('Reset puts the default filters back, turns presets and F2P off, and keeps the bankroll', async () => {
  const page = await open();
  await pressAndSettle(page, '[data-preset="roi"]');
  click(page, 'f2pFilterBtn');
  await settle();
  assert.deepEqual(activePresets(page), ['roi']);
  fill(page, { bankroll: '40000' });
  click(page, 'resetBtn');
  await settle();
  assert.deepEqual(lastQuery(page), { ...DEFAULT_QUERY, bankroll: '40000' });
  assert.deepEqual(activePresets(page), []);
  assert.equal(byId(page, 'f2pFilterBtn').getAttribute('aria-pressed'), 'false');
  assert.equal(byId<HTMLInputElement>(page, 'minRoi').value, '0');
  assert.equal(byId<HTMLInputElement>(page, 'bankroll').value, '40000');
});

test('saved filters, sort and bankroll come back, and an unknown saved sort falls back', async () => {
  const page = await open({
    storage: {
      osrs_flip_filters: JSON.stringify({ minVolume: '500', sort: 'roi', sortDir: 'asc', pageSize: '25' }),
      'osrs_bankroll::_guest_': '30000',
    },
  });
  assert.deepEqual(lastQuery(page), {
    ...DEFAULT_QUERY, minVolume: '500', sort: 'roi', sortDir: 'asc', pageSize: '25', bankroll: '30000',
  });
  assert.equal(byId<HTMLInputElement>(page, 'bankroll').value, '30000');
  assert.equal(byId<HTMLSelectElement>(page, 'flipSort').value, 'roi');
  assert.equal($(page, '#flipTable th[data-col="roi"]').className, 'sort-active sort-asc');

  const unknown = await open({ storage: { osrs_flip_filters: JSON.stringify({ sort: 'bogus' }) } });
  assert.deepEqual(lastQuery(unknown), DEFAULT_QUERY);
  const broken = await open({ storage: { osrs_flip_filters: '{' } });
  assert.deepEqual(lastQuery(broken), DEFAULT_QUERY);
});

test('a saved sort direction that is neither up nor down falls back to the default', async () => {
  const page = await open({ storage: { osrs_flip_filters: JSON.stringify({ sortDir: 'sideways' }) } });
  assert.equal(lastQuery(page).sortDir, 'desc');
  assert.equal(byId(page, 'sortDirBtn').textContent, DESC);
});

test('a failed scan says why', async () => {
  const refused = await open({ routes: { 'GET /api/ge/flips': { status: 503, body: { error: 'Scanner busy' } } } });
  assert.equal(byId(refused, 'status').textContent, 'Scanner busy');
  assert.ok(byId(refused, 'status').classList.contains('error'));
  const silent = await open({ routes: { 'GET /api/ge/flips': { status: 500, body: {} } } });
  assert.equal(byId(silent, 'status').textContent, 'Scan failed');
  const empty = await open({ routes: { 'GET /api/ge/flips': { body: { page: 1, totalPages: 1 } } } });
  assert.equal(byId(empty, 'flipBody').textContent, 'No items match.');
});

test('an older scan that answers late is ignored, whether it succeeds or fails', async () => {
  for (const late of [{ body: result([item(9, 'Stale')]) }, { html: '<p>proxy</p>' }]) {
    let answer: (reply: Reply) => void = () => {};
    let calls = 0;
    const page = await open({
      routes: {
        'GET /api/ge/flips': () => (++calls === 1 ? new Promise((resolve) => { answer = resolve; }) : { body: result() }),
      },
    });
    click(page, 'scanBtn');
    await settle();
    answer(late);
    await settle();
    assert.deepEqual(rowIds(page), ['1', '2']);
    assert.equal(byId(page, 'status').textContent, '');
  }
});
