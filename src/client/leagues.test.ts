/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, click, loadPage, runScript, settle, type Page, type Route } from './pageHarness.test.js';

const GUEST = { 'GET /api/auth/status': { body: { mode: 'guest', accounts: false } } };

function task(name: string, region: string, difficulty: string, activityType: string) {
  return { taskId: name, name, completedAt: '2026-10-01T00:00:00Z', region, difficulty, activityType };
}

const DATA = {
  username: 'zezima',
  syncedAt: '2026-10-29T18:30:00Z',
  completedTasks: [
    task('Kill a Goblin', 'Misthalin', 'Easy', 'Combat/Magic'),
    task('Fish a Shark', 'Karamja', 'Hard', 'Skilling'),
    task('Mystery task', 'Unknown', 'Unknown', 'Unknown'),
    task('Noxious Foe', 'Karamja', 'Elite', 'Combat Achievements'),
  ],
  filters: { regions: ['Karamja', 'Misthalin'], difficulties: ['Easy', 'Hard', 'Elite'], activityTypes: ['Skilling'] },
};

async function open(routes: Record<string, Route> = {}, storage: Record<string, string> = {}): Promise<Page> {
  const page = loadPage('leagues.html', { routes: { ...GUEST, ...routes }, storage });
  await runScript(page, './leagues.js');
  return page;
}

async function update(page: Page, name: string): Promise<void> {
  byId<HTMLInputElement>(page, 'username').value = name;
  click(page, 'refreshBtn');
  await settle();
}

function tasks(page: Page): string[] {
  return [...page.window.document.querySelectorAll('#taskList li strong')].map((s) => s.textContent ?? '');
}

function filter(page: Page, row: string, label: string): void {
  const button = [...byId(page, row).querySelectorAll('button')].find((b) => b.textContent === label);
  button!.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
}

test('the page starts from the name being played as', async () => {
  const page = await open({}, { osrs_current_user: 'Zezima' });
  assert.equal(byId<HTMLInputElement>(page, 'username').value, 'Zezima');
});

test('updating shows the synced tasks with their tags', async () => {
  const page = await open({ 'GET /api/leagues/Zezima': { body: DATA } });
  await update(page, ' Zezima ');
  assert.equal(byId(page, 'result').hidden, false);
  assert.equal(byId(page, 'status').textContent, '');
  assert.equal(byId(page, 'completedCount').textContent, '4');
  assert.notEqual(byId(page, 'lastSynced').textContent, 'n/a');
  assert.deepEqual(tasks(page), ['Kill a Goblin', 'Fish a Shark', 'Mystery task', 'Noxious Foe']);
  const tags = [...page.window.document.querySelectorAll('#taskList li')].map((li) =>
    [...li.querySelectorAll('.task-tag')].map((tag) => `${tag.className}=${tag.textContent}`));
  assert.deepEqual(tags[0], ['task-tag activity-combat-magic=Combat/Magic', 'task-tag region=Misthalin',
    'task-tag difficulty-easy=Easy']);
  assert.deepEqual(tags[2], ['task-tag unknown=Unknown', 'task-tag unknown=Unknown', 'task-tag unknown=Unknown']);
  assert.equal(tags[3]![0], 'task-tag activity-combat-achievements=CA');
});

test('filters narrow the list, and a hidden row that is narrowed is marked', async () => {
  const page = await open({ 'GET /api/leagues/zezima': { body: DATA } });
  await update(page, 'zezima');
  assert.deepEqual([...byId(page, 'taskRegionFilters').querySelectorAll('button')].map((b) => b.textContent),
    ['All', 'Karamja', 'Misthalin']);
  assert.equal(byId(page, 'taskDifficultyFilters').hidden, true);

  filter(page, 'taskRegionFilters', 'Karamja');
  assert.deepEqual(tasks(page), ['Fish a Shark', 'Noxious Foe']);
  filter(page, 'taskFilterTabs', 'Difficulty');
  assert.equal(byId(page, 'taskRegionFilters').hidden, true);
  assert.equal(byId(page, 'taskDifficultyFilters').hidden, false);
  const regionTab = [...byId(page, 'taskFilterTabs').querySelectorAll('button')].find((b) => b.textContent === 'Region');
  assert.ok(regionTab!.classList.contains('has-filter'));

  filter(page, 'taskDifficultyFilters', 'Easy');
  assert.equal(byId(page, 'taskList').textContent?.trim(), 'No completed tasks match this filter.');
});

test('a name that has never synced gets the setup steps', async () => {
  const page = await open({ 'GET /api/leagues/nobody': { status: 404, body: { error: 'Not synced' } } });
  byId<HTMLInputElement>(page, 'username').value = 'nobody';
  byId(page, 'username').dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter' }));
  await settle();
  assert.equal(byId(page, 'syncHelp').hidden, false);
  assert.ok(byId(page, 'syncHelp').textContent?.includes('No synced leagues data found for this name.'));
  assert.equal(byId(page, 'result').hidden, true);
  assert.equal(byId(page, 'status').textContent, '');
});

test('a failed update says why', async () => {
  const page = await open({ 'GET /api/leagues/zezima': { status: 500, body: { error: 'Disk full' } } });
  await update(page, 'zezima');
  assert.equal(byId(page, 'status').textContent, 'Disk full');
  assert.ok(byId(page, 'status').classList.contains('error'));
  page.routes['GET /api/leagues/zezima'] = { status: 500, body: {} };
  await update(page, 'zezima');
  assert.equal(byId(page, 'status').textContent, 'Update failed');
});

test('an empty name looks nothing up', async () => {
  const page = await open();
  await update(page, '   ');
  assert.equal(page.requests.filter((r) => r.url.startsWith('/api/leagues')).length, 0);
});

test('an older update that answers late is ignored', async () => {
  let answerFirst: (reply: { body: unknown }) => void = () => {};
  const page = await open({
    'GET /api/leagues/slow': () => new Promise((resolve) => { answerFirst = resolve; }),
    'GET /api/leagues/zezima': { body: DATA },
  });
  byId<HTMLInputElement>(page, 'username').value = 'slow';
  click(page, 'refreshBtn');
  await update(page, 'zezima');
  answerFirst({ body: { ...DATA, completedTasks: [] } });
  await settle();
  assert.equal(byId(page, 'completedCount').textContent, '4');
});

test('switching who is played as fills in the new name', async () => {
  const page = await open();
  page.window.localStorage.setItem('osrs_current_user', 'Lynx Titan');
  page.window.dispatchEvent(new page.window.Event('osrs-session-change'));
  assert.equal(byId<HTMLInputElement>(page, 'username').value, 'Lynx Titan');
});
