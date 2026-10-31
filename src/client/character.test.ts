/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle, type Page, type Reply, type Route } from './pageHarness.test.js';

const GUEST = { 'GET /api/auth/status': { body: { mode: 'guest', accounts: false } } };

const HISCORES = {
  username: 'Zezima', combatLevel: 126, totalLevel: 2277, totalXp: 4_600_000_000,
  skills: [{ name: 'Attack', level: 99, xp: 200_000_000, rank: 1 }, { name: 'Sailing', level: 1, xp: 0, rank: null }],
  bosses: [{ name: '<i>Zulrah</i>', score: 1500, rank: 42 }],
  minigames: [],
  others: [{ name: 'Clue Scrolls (all)', score: 10, rank: null }],
};
const QUESTS = {
  summary: { complete: 1, inProgress: 1, notStarted: 1 },
  quests: [
    { name: "Cook's Assistant", state: 'FINISHED', kind: 'quest', members: false },
    { name: 'Alfred Grimhand', state: 'IN_PROGRESS', kind: 'miniquest', members: true },
    { name: 'Dragon Slayer II', state: 'NOT_STARTED', kind: 'quest', members: true },
  ],
};
const DIARIES = {
  summary: { complete: 2, total: 48 }, syncedAt: '2026-10-29T18:30:00Z',
  areas: [
    { area: 'ARDOUGNE', name: 'Ardougne', complete: 2, total: 4, tiers: [
      { tier: 'EASY', complete: true }, { tier: 'MEDIUM', complete: true },
      { tier: 'HARD', complete: false }, { tier: 'ELITE', complete: false },
    ] },
    { area: 'KARAMJA', name: 'Karamja', complete: 0, total: 1, tiers: [{ tier: 'ELITE', complete: false }] },
  ],
};
const COMBAT = {
  summary: { points: 120, complete: 2, total: 3 },
  groups: [{ key: 'zulrah', name: 'Zulrah', complete: 2, total: 2 }, { key: 'vorkath', name: 'Vorkath', complete: 0, total: 1 }],
  tasks: [
    { name: 'Snake Rebound', group: 'Zulrah', groupKey: 'zulrah', tier: 'Elite', complete: true },
    { name: 'Zulrah Veteran', group: 'Zulrah', groupKey: 'zulrah', tier: null, complete: true },
    { name: 'Dodging Dragon', group: 'Vorkath', groupKey: 'vorkath', tier: 'Master', complete: false },
  ],
};
const LOG = {
  itemsObtained: 3, itemsAvailable: 1500, categoriesFinished: 1, categoriesAvailable: 200, syncedAt: '2026-10-29T18:30:00Z',
  groups: [
    { group: 'Bosses', categories: [
      { key: 'zulrah', name: 'Zulrah', obtained: 2, total: 2, items: [
        { name: 'Tanzanite fang', icon: 'fang.png', count: 1 }, { name: 'Magic fang', icon: 'magic.png', count: 1 },
      ] },
      { key: 'vorkath', name: 'Vorkath', obtained: 1, total: 3, items: [
        { name: 'Vorkath head', icon: 'head.png', count: 1 }, { name: 'Draconic visage', icon: 'visage.png', count: 0 },
      ] },
      { key: 'kq', name: 'Kalphite Queen', obtained: 0, total: 5, items: [] },
    ] },
    { group: 'Raids', categories: [{ key: 'cox', name: 'Chambers of Xeric', obtained: 0, total: 20, items: [] }] },
  ],
};

function player(name: string, overrides: Partial<Record<'hiscores' | 'quests' | 'diaries' | 'combatachievements' | 'collectionlog', Route>> = {}): Record<string, Route> {
  return {
    [`GET /api/hiscores/${name}`]: overrides.hiscores ?? { body: HISCORES },
    [`GET /api/quests/${name}`]: overrides.quests ?? { body: QUESTS },
    [`GET /api/diaries/${name}`]: overrides.diaries ?? { body: DIARIES },
    [`GET /api/combatachievements/${name}`]: overrides.combatachievements ?? { body: COMBAT },
    [`GET /api/collectionlog/${name}`]: overrides.collectionlog ?? { body: LOG },
  };
}

async function open(routes: Record<string, Route> = player('Zezima'), storage: Record<string, string> = {}): Promise<Page> {
  const page = loadPage('character.html', { routes: { ...GUEST, ...routes }, storage });
  page.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
    this.dataset.scrolled = 'yes';
  };
  await runScript(page, './character.js');
  return page;
}

async function lookUp(page: Page, name: string): Promise<void> {
  byId<HTMLInputElement>(page, 'username').value = name;
  click(page, 'searchBtn');
  await settle();
}

function texts(page: Page, selector: string): string[] {
  return [...page.window.document.querySelectorAll(selector)].map((n) => n.textContent?.trim() ?? '');
}

function pick(page: Page, rowId: string, label: string): void {
  const button = [...byId(page, rowId).querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label));
  if (!button) throw new Error(`no "${label}" button in #${rowId}`);
  button.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
}

function tableRows(page: Page, panel: string): string[][] {
  return [...byId(page, panel).querySelectorAll('tbody tr')]
    .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));
}

test('the name box starts from the name being played as and follows a switch', async () => {
  const page = await open(player('Zezima'), { osrs_current_user: 'Zezima' });
  assert.equal(byId<HTMLInputElement>(page, 'username').value, 'Zezima');
  page.window.localStorage.setItem('osrs_current_user', 'Lynx Titan');
  page.window.dispatchEvent(new page.window.Event('osrs-session-change'));
  assert.equal(byId<HTMLInputElement>(page, 'username').value, 'Lynx Titan');
});

test('a lookup shows the hiscores, with unranked rows marked and names escaped', async () => {
  const page = await open(player('Lynx%20Titan'));
  await lookUp(page, ' Lynx Titan ');
  assert.equal(page.requests.filter((r) => r.url.startsWith('/api/hiscores/'))[0]?.url, '/api/hiscores/Lynx%20Titan');
  assert.equal(byId(page, 'status').textContent, '');
  assert.equal(byId(page, 'result').hidden, false);
  assert.deepEqual([byId(page, 'combatLevel').textContent, byId(page, 'totalLevel').textContent,
    byId(page, 'totalXp').textContent], ['126', '2,277', '4,600,000,000']);
  assert.deepEqual(tableRows(page, 'tab-skills'), [['Attack', '99', '200,000,000', '1'], ['Sailing', '1', '0', '-']]);
  assert.deepEqual(tableRows(page, 'tab-bosses'), [['<i>Zulrah</i>', '1,500', '42']]);
  assert.equal(byId(page, 'tab-bosses').querySelector('i'), null);
  assert.equal(byId(page, 'tab-minigames').textContent, 'No ranked Minigame yet.');
  assert.deepEqual(tableRows(page, 'tab-clues'), [['Clue Scrolls (all)', '10', '-']]);
});

test('the main tabs show one panel at a time', async () => {
  const page = await open();
  page.window.document.querySelector<HTMLButtonElement>('#mainTabs [data-tab="diaries"]')!.click();
  const shown = [...page.window.document.querySelectorAll<HTMLElement>('.tab-panel')].filter((p) => !p.hidden).map((p) => p.id);
  assert.deepEqual(shown, ['tab-diaries']);
  assert.deepEqual(texts(page, '#mainTabs button.active'), ['Diaries']);
});

test('quests filter by status, type and membership, and a new lookup clears the filters', async () => {
  const page = await open();
  await lookUp(page, 'Zezima');
  assert.equal(byId(page, 'questResult').hidden, false);
  assert.deepEqual([byId(page, 'questsComplete').textContent, byId(page, 'questsInProgress').textContent,
    byId(page, 'questsNotStarted').textContent], ['1', '1', '1']);
  assert.deepEqual(texts(page, '#questList strong'), ["Cook's Assistant", 'Alfred Grimhand', 'Dragon Slayer II']);
  const tags = [...page.window.document.querySelectorAll('#questList li')][1]!.querySelectorAll('.quest-meta > span');
  assert.deepEqual([...tags].map((t) => `${t.className}=${t.textContent}`),
    ['quest-tag miniquest=Miniquest', 'quest-tag members=Members', 'quest-state cl-pill started=In progress']);

  pick(page, 'questStateFilters', 'Not Completed');
  assert.deepEqual(texts(page, '#questList strong'), ['Dragon Slayer II']);
  pick(page, 'questFilterTabs', 'Type');
  assert.equal(byId(page, 'questStateFilters').hidden, true);
  assert.equal(byId(page, 'questTypeFilters').hidden, false);
  pick(page, 'questTypeFilters', 'Miniquest');
  assert.equal(byId(page, 'questList').textContent?.trim(), 'No quests match this filter.');
  assert.deepEqual(texts(page, '#questFilterTabs button.has-filter'), ['Completion Status', 'Type']);

  pick(page, 'questStateFilters', 'All');
  pick(page, 'questFilterTabs', 'Membership');
  pick(page, 'questMemberFilters', 'Free to Play');
  assert.equal(byId(page, 'questList').textContent?.trim(), 'No quests match this filter.');
  pick(page, 'questTypeFilters', 'All');
  assert.deepEqual(texts(page, '#questList strong'), ["Cook's Assistant"]);
  pick(page, 'questMemberFilters', 'Members');
  assert.deepEqual(texts(page, '#questList strong'), ['Alfred Grimhand', 'Dragon Slayer II']);

  await lookUp(page, 'Zezima');
  assert.equal(page.window.document.querySelectorAll('#questList li').length, 3);
  assert.deepEqual(texts(page, '#questFilterTabs button.has-filter'), []);
});

test('diaries show each tier, and Karamja explains its missing tiers', async () => {
  const page = await open();
  await lookUp(page, 'Zezima');
  assert.deepEqual([byId(page, 'diariesComplete').textContent, byId(page, 'diariesTotal').textContent], ['2', '48']);
  assert.notEqual(byId(page, 'diariesLastSynced').textContent, 'n/a');
  const [ardougne, karamja] = [...page.window.document.querySelectorAll('#diaryAreas .diary-card')];
  assert.deepEqual([...ardougne!.querySelectorAll('.diary-tiers span')].map((s) => `${s.className}=${s.textContent}`),
    ['cl-pill complete=Easy', 'cl-pill complete=Medium', 'cl-pill=Hard', 'cl-pill=Elite']);
  assert.equal(ardougne!.querySelector('.diary-count')!.textContent, '2/4 tiers complete');
  assert.equal(ardougne!.querySelector('p.status'), null);
  assert.match(karamja!.querySelector('p.status')!.textContent!, /not available as tier-complete flags for Karamja/);
});

test('combat achievements filter by boss and by completion', async () => {
  const page = await open();
  await lookUp(page, 'Zezima');
  assert.deepEqual([byId(page, 'caPoints').textContent, byId(page, 'caComplete').textContent,
    byId(page, 'caTotal').textContent], ['120', '2', '3']);
  const pills = () => [...byId(page, 'caGroupPills').querySelectorAll('button')].map((b) => `${b.className}=${b.textContent}`);
  assert.deepEqual(pills(), ['cl-pill started active=All 2/3', 'cl-pill complete=Zulrah 2/2', 'cl-pill=Vorkath 0/1']);
  const toggle = byId(page, 'caGroupToggle');
  assert.deepEqual([toggle.textContent, byId(page, 'caGroupPanel').hidden, toggle.getAttribute('aria-expanded')],
    ['Filter by Boss', true, 'false']);
  const zulrahTasks = [...byId(page, 'caTaskList').querySelectorAll('li')].slice(0, 2)
    .map((li) => [...li.querySelectorAll('.quest-tag')].map((t) => t.textContent));
  assert.deepEqual(zulrahTasks, [['Zulrah', 'Elite'], ['Zulrah']]);

  click(page, 'caGroupToggle');
  assert.deepEqual([toggle.textContent, byId(page, 'caGroupPanel').hidden], ['Hide boss filter', false]);
  pick(page, 'caGroupPills', 'Vorkath');
  assert.deepEqual(texts(page, '#caTaskList strong'), ['Dodging Dragon']);
  byId(page, 'caGroupPills').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(texts(page, '#caTaskList strong'), ['Dodging Dragon']);
  click(page, 'caGroupToggle');
  assert.equal(toggle.textContent, 'Filter by Boss: Vorkath');

  pick(page, 'caCompletionFilters', 'Complete');
  assert.equal(byId(page, 'caTaskList').textContent?.trim(), 'No tasks match this filter.');
  pick(page, 'caCompletionFilters', 'Incomplete');
  assert.deepEqual(texts(page, '#caTaskList strong'), ['Dodging Dragon']);
  pick(page, 'caGroupPills', 'All');
  pick(page, 'caCompletionFilters', 'Complete');
  assert.deepEqual(texts(page, '#caTaskList strong'), ['Snake Rebound', 'Zulrah Veteran']);
});

test('the collection log groups its categories, filters them by progress and opens one', async () => {
  const page = await open();
  await lookUp(page, 'Zezima');
  assert.deepEqual([byId(page, 'itemsObtained').textContent, byId(page, 'categoriesFinished').textContent],
    ['3 / 1,500', '1 / 200']);
  assert.notEqual(byId(page, 'lastSynced').textContent, 'n/a');
  assert.deepEqual(texts(page, '#groupTabs .cl-row-part:first-child button'), ['Bosses', 'Raids']);
  assert.deepEqual(texts(page, '#groupTabs button.active'), ['Bosses', 'All']);
  const pills = () => [...byId(page, 'groups').querySelectorAll('button')].map((b) => `${b.className}=${b.textContent}`);
  assert.deepEqual(pills(), ['cl-pill complete=Zulrah 2/2', 'cl-pill started=Vorkath 1/3', 'cl-pill=Kalphite Queen 0/5']);
  assert.equal(byId(page, 'gridTitle').textContent, 'Pick a category below to see its items');

  pick(page, 'groups', 'Vorkath');
  assert.equal(byId(page, 'gridTitle').textContent, 'Vorkath (1/3)');
  assert.equal(byId(page, 'gridTitle').dataset.scrolled, 'yes');
  assert.deepEqual([...byId(page, 'itemGrid').querySelectorAll('.cl-slot')].map((s) => `${s.className.trim()}=${s.textContent?.trim()}`),
    ['cl-slot obtained=Vorkath head', 'cl-slot missing=Draconic visage']);
  assert.deepEqual(texts(page, '#groups button.active'), ['Vorkath 1/3']);
  byId(page, 'groups').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
  assert.equal(byId(page, 'gridTitle').textContent, 'Vorkath (1/3)');

  for (const [filter, shown] of [['Completed', ['Zulrah 2/2']], ['Started', ['Vorkath 1/3']], ['Not Started', ['Kalphite Queen 0/5']]] as const) {
    pick(page, 'groupTabs', filter);
    assert.deepEqual(texts(page, '#groups button'), shown, filter);
  }
  pick(page, 'groupTabs', 'Raids');
  pick(page, 'groupTabs', 'Completed');
  assert.equal(byId(page, 'groups').textContent, 'No categories match this filter.');
  byId(page, 'groupTabs').querySelector('.cl-row-part')!.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(texts(page, '#groupTabs .cl-row-part:first-child button.active'), ['Raids']);
});

test('a name that has never synced gets the setup steps on each synced tab', async () => {
  const missing = { status: 404, body: { error: 'Not synced' } };
  const page = await open(player('Zezima', { quests: missing, diaries: missing, combatachievements: missing, collectionlog: missing }));
  await lookUp(page, 'Zezima');
  assert.equal(byId(page, 'status').textContent, '');
  for (const [help, result, text] of [
    ['questSyncHelp', 'questResult', 'No synced quest data found for this name.'],
    ['diarySyncHelp', 'diaryResult', 'No synced achievement diary data found for this name.'],
    ['caSyncHelp', 'caResult', 'No synced combat achievement data found for this name.'],
    ['clSyncHelp', 'clResult', 'No synced collection log found for this name.'],
  ]) {
    assert.equal(byId(page, help!).hidden, false, help);
    assert.ok(byId(page, help!).textContent!.includes(text!), help);
    assert.equal(byId(page, result!).hidden, true, result);
  }
});

test('a failed lookup or tab says why', async () => {
  const page = await open({
    ...player('ghost', { hiscores: { status: 404, body: { error: 'Player not found' } } }),
    ...player('quiet', { hiscores: { status: 500, body: {} } }),
    ...player('Zezima', { quests: { status: 500, body: { error: 'Quest store is down' } } }),
    ...player('Woox', { combatachievements: { status: 500, body: {} } }),
  });
  await lookUp(page, 'ghost');
  assert.equal(byId(page, 'status').textContent, 'Player not found');
  assert.ok(byId(page, 'status').classList.contains('error'));
  assert.equal(byId(page, 'result').hidden, true);
  assert.equal(page.requests.filter((r) => r.url.startsWith('/api/quests/')).length, 0);

  await lookUp(page, 'quiet');
  assert.equal(byId(page, 'status').textContent, 'Lookup failed');
  await lookUp(page, 'Zezima');
  assert.equal(byId(page, 'status').textContent, 'Quest store is down');
  assert.equal(byId(page, 'result').hidden, false);
  await lookUp(page, 'Woox');
  assert.equal(byId(page, 'status').textContent, 'Failed to load combat achievements');
});

test('an empty name looks nothing up', async () => {
  const page = await open();
  await lookUp(page, '   ');
  assert.equal(page.requests.filter((r) => r.url.startsWith('/api/hiscores/')).length, 0);
});

test('an older lookup that answers late is ignored, from the hiscores or from a tab', async () => {
  let answerHiscores: (reply: Reply) => void = () => {};
  const page = await open({
    ...player('slow', { hiscores: () => new Promise((resolve) => { answerHiscores = resolve; }) }),
    ...player('Zezima'),
  });
  byId<HTMLInputElement>(page, 'username').value = 'slow';
  click(page, 'searchBtn');
  await lookUp(page, 'Zezima');
  answerHiscores({ body: { ...HISCORES, combatLevel: 3 } });
  await settle();
  assert.equal(byId(page, 'combatLevel').textContent, '126');
  byId<HTMLInputElement>(page, 'username').value = 'slow';
  click(page, 'searchBtn');
  await lookUp(page, 'Zezima');
  answerHiscores({ html: '<p>proxy</p>' });
  await settle();
  assert.equal(byId(page, 'status').textContent, '');

  for (const late of [{ body: { ...QUESTS, quests: [] } }, { html: '<p>proxy</p>' }]) {
    let answerQuests: (reply: Reply) => void = () => {};
    const tabs = await open({
      ...player('slow', { quests: () => new Promise((resolve) => { answerQuests = resolve; }) }),
      ...player('Zezima'),
    });
    await lookUp(tabs, 'slow');
    await lookUp(tabs, 'Zezima');
    answerQuests(late);
    await settle();
    assert.equal(tabs.window.document.querySelectorAll('#questList li').length, 3);
    assert.equal(byId(tabs, 'status').textContent, '');
  }
});
