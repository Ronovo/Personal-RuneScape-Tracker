/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle, type Page, type Reply, type Route } from './pageHarness.test.js';

const GUEST = { 'GET /api/auth/status': { body: { mode: 'guest', accounts: false } } };
const DESC = '↓ High to low';
const ASC = '↑ Low to high';
const DOT = '·';

function mover(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, members: false, icon: `https://wiki.test/${id}.png`, currentPrice: 1000, pastPrice: 900,
    volume24h: 25000, pctChange: 11.1, pctChange1h: null, pctChange6h: null, high: 1010, low: 990, buyLimit: 100,
    marginAfterTax: 2_500_000, roi: 1, profitPerLimit: 100, gpPerHour: 10, highTime: null, lowTime: null, ...extra,
  };
}

const MOVERS = {
  risers: [mover(1, 'Riser')], fallers: [mover(2, 'Faller', { pctChange: -5 })], items: [mover(3, 'Busy')],
  consideredCount: 3,
};
const DEFAULT_QUERY = {
  minVolume: '500', minPrice: '50', membersOnly: 'all', sort: 'pctChange', sortDir: 'desc', hideStale: '0',
  limit: '25', view: 'risers',
};

async function open(routes: Record<string, Route> = {}, storage: Record<string, string> = {}): Promise<Page> {
  const page = loadPage('ge.html', { routes: { ...GUEST, 'GET /api/ge/movers': { body: MOVERS }, ...routes }, storage });
  await runScript(page, './ge.js');
  return page;
}

function queries(page: Page, path = '/api/ge/movers'): Record<string, string>[] {
  return page.requests.filter((r) => r.url.split('?')[0] === path)
    .map((r) => Object.fromEntries(new URLSearchParams(r.url.split('?')[1])));
}

function lastQuery(page: Page, path?: string): Record<string, string> {
  const all = queries(page, path);
  return all[all.length - 1]!;
}

function names(page: Page): string[] {
  return [...page.window.document.querySelectorAll('#grid .name')].map((n) => n.textContent ?? '');
}

async function view(page: Page, name: string): Promise<void> {
  page.window.document.querySelector<HTMLButtonElement>(`#directionToggle [data-view="${name}"]`)!.click();
  await settle();
}

function activeViews(page: Page): string[] {
  return [...page.window.document.querySelectorAll<HTMLButtonElement>('#directionToggle button.active')]
    .map((b) => b.dataset.view!);
}

async function choose(page: Page, id: string, value: string): Promise<void> {
  byId<HTMLSelectElement>(page, id).value = value;
  byId(page, id).dispatchEvent(new page.window.Event('change'));
  await settle();
}

async function type(page: Page, text: string): Promise<void> {
  byId<HTMLInputElement>(page, 'itemSearch').value = text;
  byId(page, 'itemSearch').dispatchEvent(new page.window.Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settle();
}

function sortState(page: Page): { disabled: boolean; title: string; dir: string | null } {
  return { disabled: byId<HTMLSelectElement>(page, 'sortBy').disabled, title: byId(page, 'sortBy').title,
    dir: byId(page, 'sortDirBtn').textContent };
}

test('the page opens on Rising with the default filters and remembers them', async () => {
  const page = await open();
  assert.deepEqual(queries(page), [DEFAULT_QUERY]);
  assert.equal(byId(page, 'gridTitle').textContent, 'Rising (24h)');
  assert.equal(byId(page, 'status').textContent, '');
  assert.deepEqual(names(page), ['Riser']);
  assert.deepEqual(activeViews(page), ['risers']);
  assert.deepEqual(sortState(page), { disabled: false, title: '', dir: DESC });
  assert.equal(byId(page, 'sortDirBtn').title, 'Toggle sort direction');
  assert.deepEqual(JSON.parse(page.window.localStorage.getItem('osrs_ge_filters')!), {
    minVolume: '500', minPrice: '50', maxPrice: '', maxAgeMinutes: '', hideStale: false, membersOnly: 'all',
    sort: 'pctChange', gridSize: '25', sortDir: 'desc', view: 'risers',
  });
});

test('a card links to its item and the Flip Helper and shows what is known about it', async () => {
  const page = await open();
  const cell = page.window.document.querySelector('#grid .ge-cell')!;
  assert.equal(cell.querySelector('.ge-cell-main')!.getAttribute('href'), 'item.html?id=1');
  assert.equal(cell.querySelector('.flip-link')!.getAttribute('href'), 'flip.html?ids=1&from=ge');
  assert.equal(cell.querySelector('img')!.getAttribute('src'), 'https://wiki.test/1.png');
  assert.equal(cell.querySelector('.price')!.textContent, '1,000 gp');
  assert.equal(cell.querySelector('.pct')!.className, 'pct up');
  assert.equal(cell.querySelector('.pct')!.textContent, '+11.1% ~24h change');
  assert.equal(cell.querySelector('.meta')!.textContent, `2.5m after tax ${DOT} 25,000 /day`);
});

test('each view asks for its own list and starts from its natural order', async () => {
  const page = await open();
  await view(page, 'fallers');
  assert.deepEqual(lastQuery(page), { ...DEFAULT_QUERY, view: 'fallers', sortDir: 'asc' });
  assert.deepEqual(names(page), ['Faller']);
  assert.equal(byId(page, 'gridTitle').textContent, 'Dropping (24h)');
  assert.equal(sortState(page).dir, ASC);

  await view(page, 'volume');
  assert.equal(byId<HTMLSelectElement>(page, 'sortBy').value, 'volume');
  assert.deepEqual(lastQuery(page), { ...DEFAULT_QUERY, view: 'volume', sort: 'volume' });
  assert.deepEqual(names(page), ['Busy']);
  assert.equal(byId(page, 'gridTitle').textContent, 'High Volume');

  await choose(page, 'sortBy', 'price');
  await view(page, 'volume');
  assert.equal(lastQuery(page).sort, 'price');

  await view(page, 'risers');
  assert.deepEqual(lastQuery(page), { ...DEFAULT_QUERY, sort: 'price' });
  assert.deepEqual(activeViews(page), ['risers']);
});

test('an empty list says nothing matches', async () => {
  const page = await open({ 'GET /api/ge/movers': { body: { consideredCount: 0 } } });
  assert.equal(byId(page, 'grid').textContent, 'No items match.');
});

test('Random keeps its pick on refresh, rerolls when clicked again and cannot be sorted', async () => {
  const page = await open();
  await view(page, 'random');
  const first = lastQuery(page).seed;
  assert.match(first!, /^\d+-\d+$/);
  assert.equal(byId(page, 'gridTitle').textContent, 'Random');
  assert.deepEqual(sortState(page), {
    disabled: true, title: 'Random picks its own order - switch views to sort.', dir: DESC,
  });
  assert.equal(byId<HTMLButtonElement>(page, 'sortDirBtn').disabled, true);

  click(page, 'refreshBtn');
  await settle();
  assert.equal(lastQuery(page).seed, first);
  await view(page, 'random');
  assert.notEqual(lastQuery(page).seed, first);

  await view(page, 'risers');
  assert.equal(lastQuery(page).seed, undefined);
  assert.equal(sortState(page).disabled, false);
});

test('the sort controls reload the grid, and a new key starts from its natural direction', async () => {
  const page = await open();
  click(page, 'sortDirBtn');
  await settle();
  assert.equal(lastQuery(page).sortDir, 'asc');
  assert.equal(sortState(page).dir, ASC);

  await choose(page, 'sortBy', 'price');
  assert.deepEqual(lastQuery(page), { ...DEFAULT_QUERY, sort: 'price' });
  await view(page, 'fallers');
  await choose(page, 'sortBy', 'pctChange');
  assert.equal(lastQuery(page).sortDir, 'asc');
});

test('the filter drawer is read on Refresh, and Reset puts the defaults back', async () => {
  const page = await open();
  await view(page, 'fallers');
  const before = queries(page).length;
  const fill = (id: string, value: string) => { byId<HTMLInputElement>(page, id).value = value; };
  fill('minVolume', '1000');
  fill('maxPrice', '5000');
  fill('maxAgeMinutes', '15');
  byId<HTMLInputElement>(page, 'hideStale').checked = true;
  await choose(page, 'membersOnly', 'members');
  assert.equal(queries(page).length, before);

  click(page, 'refreshBtn');
  await settle();
  assert.deepEqual(lastQuery(page), {
    ...DEFAULT_QUERY, view: 'fallers', sortDir: 'asc', minVolume: '1000', maxPrice: '5000', maxAgeMinutes: '15',
    hideStale: '1', membersOnly: 'members',
  });

  await choose(page, 'gridSize', '50');
  assert.equal(lastQuery(page).limit, '50');

  click(page, 'resetBtn');
  await settle();
  assert.deepEqual(lastQuery(page), { ...DEFAULT_QUERY, view: 'fallers', sortDir: 'asc' });
  assert.equal(byId<HTMLInputElement>(page, 'maxPrice').value, '');
  assert.equal(byId<HTMLInputElement>(page, 'hideStale').checked, false);
  assert.equal(byId<HTMLSelectElement>(page, 'gridSize').value, '25');
});

test('saved filters, view and direction come back on the next visit', async () => {
  const saved = (value: unknown) => ({ osrs_ge_filters: JSON.stringify(value) });
  const page = await open({}, saved({
    minVolume: '2000', maxPrice: '', sort: 'price', gridSize: '10', hideStale: true, view: 'fallers', sortDir: 'desc',
  }));
  assert.deepEqual(lastQuery(page), {
    ...DEFAULT_QUERY, minVolume: '2000', sort: 'price', limit: '10', hideStale: '1', view: 'fallers',
  });
  assert.deepEqual(activeViews(page), ['fallers']);

  const random = await open({}, saved({ view: 'random' }));
  assert.ok(lastQuery(random).seed);
  assert.equal(sortState(random).disabled, true);

  const noDirection = await open({}, saved({ view: 'fallers' }));
  assert.equal(lastQuery(noDirection).sortDir, 'asc');

  const junk = await open({}, saved({ view: 'nonsense', sortDir: 'sideways', gridSize: '7' }));
  assert.deepEqual(lastQuery(junk), DEFAULT_QUERY);

  const broken = await open({}, { osrs_ge_filters: '{' });
  assert.deepEqual(lastQuery(broken), DEFAULT_QUERY);
});

test('a saved view named like a built-in property still opens Rising', async () => {
  for (const name of ['toString', 'constructor']) {
    const page = await open({}, { osrs_ge_filters: JSON.stringify({ view: name }) });
    assert.equal(lastQuery(page).view, 'risers', name);
    assert.equal(byId(page, 'gridTitle').textContent, 'Rising (24h)', name);
  }
});

test('the F2P button narrows the grid and puts back what was picked before', async () => {
  const page = await open();
  const button = byId(page, 'f2pFilterBtn');
  await choose(page, 'membersOnly', 'members');
  assert.equal(queries(page).length, 1);
  assert.equal(button.getAttribute('aria-pressed'), 'false');

  click(page, 'f2pFilterBtn');
  await settle();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(lastQuery(page).membersOnly, 'f2p');
  assert.equal(byId(page, 'gridTitle').textContent, `Rising (24h) ${DOT} F2P`);

  click(page, 'f2pFilterBtn');
  await settle();
  assert.equal(lastQuery(page).membersOnly, 'members');
  assert.equal(button.classList.contains('active'), false);

  click(page, 'f2pFilterBtn');
  await settle();
  click(page, 'resetBtn');
  await settle();
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(lastQuery(page).membersOnly, 'all');
});

test('a saved F2P filter shows the F2P button as on', async () => {
  const page = await open({}, { osrs_ge_filters: JSON.stringify({ membersOnly: 'f2p' }) });
  assert.equal(lastQuery(page).membersOnly, 'f2p');
  assert.equal(byId(page, 'f2pFilterBtn').getAttribute('aria-pressed'), 'true');
  assert.ok(byId(page, 'f2pFilterBtn').classList.contains('active'));
});

test('typing a name searches after a pause, and clearing it goes back to Rising', async () => {
  const results = [{
    id: 9, name: '<b>Odd</b>', icon: 'x.png" onerror="y', members: false, currentPrice: null, pctChange: null,
    volume24h: 3, marginAfterTax: null,
  }];
  const page = await open({ 'GET /api/ge/search': { body: results } });
  byId<HTMLInputElement>(page, 'itemSearch').value = 'whip';
  byId(page, 'itemSearch').dispatchEvent(new page.window.Event('input'));
  assert.deepEqual(queries(page, '/api/ge/search'), []);
  await type(page, ' whip ');
  assert.deepEqual(queries(page, '/api/ge/search'), [{ q: 'whip', membersOnly: 'all', limit: '25' }]);
  assert.equal(byId(page, 'gridTitle').textContent, 'Search: "whip"');
  assert.deepEqual(sortState(page), {
    disabled: true, title: 'Search results are ranked by how well they match - clear the search to sort.', dir: DESC,
  });

  const cell = page.window.document.querySelector('#grid .ge-cell')!;
  assert.equal(cell.querySelector('b'), null);
  assert.equal(cell.querySelector('.name')!.textContent, '<b>Odd</b>');
  assert.equal(cell.querySelector('img')!.hasAttribute('onerror'), false);
  assert.equal(cell.querySelector('.price')!.textContent, 'n/a');
  assert.equal(cell.querySelector('.pct'), null);
  assert.equal(cell.querySelector('.meta')!.textContent, '3 /day');

  const movers = queries(page).length;
  click(page, 'refreshBtn');
  await settle();
  await choose(page, 'gridSize', '50');
  assert.equal(queries(page).length, movers);
  assert.deepEqual(queries(page, '/api/ge/search').map((q) => q.limit), ['25', '25', '50']);

  click(page, 'f2pFilterBtn');
  await settle();
  assert.equal(byId(page, 'gridTitle').textContent, `Search: "whip" ${DOT} F2P`);
  assert.equal(lastQuery(page, '/api/ge/search').membersOnly, 'f2p');

  await type(page, '  ');
  assert.equal(queries(page).length, movers + 1);
  assert.equal(byId(page, 'gridTitle').textContent, `Rising (24h) ${DOT} F2P`);
  assert.equal(sortState(page).disabled, false);
});

test('searching from High Volume or Random goes back to Rising, and from Dropping it stays', async () => {
  const page = await open({ 'GET /api/ge/search': { body: [] } });
  for (const [from, to] of [['volume', 'risers'], ['random', 'risers'], ['fallers', 'fallers']]) {
    await view(page, from!);
    await type(page, 'rune');
    assert.deepEqual(activeViews(page), [to], from);
    assert.equal(byId(page, 'grid').textContent, 'No items match.');
  }
});

test('picking a view while a typed search is still waiting does not run that search', async () => {
  const page = await open({ 'GET /api/ge/search': { body: [] } });
  byId<HTMLInputElement>(page, 'itemSearch').value = 'whip';
  byId(page, 'itemSearch').dispatchEvent(new page.window.Event('input'));
  await view(page, 'volume');
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settle();
  assert.deepEqual(queries(page, '/api/ge/search'), []);
  assert.equal(byId(page, 'gridTitle').textContent, 'High Volume');
  assert.deepEqual(activeViews(page), ['volume']);
});

test('failed loads say why, and the next load starts clean', async () => {
  const failing = await open({ 'GET /api/ge/movers': { status: 503, body: { error: 'Prices are down' } } });
  assert.equal(byId(failing, 'status').textContent, 'Prices are down');
  assert.ok(byId(failing, 'status').classList.contains('error'));
  failing.routes['GET /api/ge/movers'] = () => new Promise(() => {});
  click(failing, 'refreshBtn');
  assert.equal(byId(failing, 'status').textContent, 'Loading...');
  assert.equal(byId(failing, 'status').classList.contains('error'), false);

  const silent = await open({ 'GET /api/ge/movers': { status: 500, body: {} } });
  assert.equal(byId(silent, 'status').textContent, 'Failed to load movers');

  const search = await open({ 'GET /api/ge/search': { status: 400, body: { error: 'Query too short' } } });
  await type(search, 'a');
  assert.equal(byId(search, 'status').textContent, 'Query too short');
  search.routes['GET /api/ge/search'] = { status: 500, body: {} };
  await type(search, 'ab');
  assert.equal(byId(search, 'status').textContent, 'Search failed');
  search.routes['GET /api/ge/search'] = () => new Promise(() => {});
  click(search, 'refreshBtn');
  assert.equal(byId(search, 'status').textContent, 'Searching...');
  assert.equal(byId(search, 'status').classList.contains('error'), false);
});

test('an older load that answers late is ignored, whether it succeeds or fails', async () => {
  for (const late of [{ body: MOVERS }, { html: '<p>proxy</p>' }]) {
    let answer: (reply: Reply) => void = () => {};
    const page = await open({
      'GET /api/ge/movers': (_body, url) => (url.searchParams.get('view') === 'risers'
        ? new Promise((resolve) => { answer = resolve; })
        : { body: MOVERS }),
    });
    await view(page, 'fallers');
    answer(late);
    await settle();
    assert.deepEqual(names(page), ['Faller']);
    assert.equal(byId(page, 'status').classList.contains('error'), false);
  }

  for (const late of [{ body: [mover(7, 'Old result')] }, { html: '<p>proxy</p>' }]) {
    let answer: (reply: Reply) => void = () => {};
    const page = await open({ 'GET /api/ge/search': () => new Promise((resolve) => { answer = resolve; }) });
    await type(page, 'old');
    await type(page, '');
    answer(late);
    await settle();
    assert.deepEqual(names(page), ['Riser']);
    assert.equal(byId(page, 'status').textContent, '');
  }
});
