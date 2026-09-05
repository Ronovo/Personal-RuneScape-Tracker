// Collection log browser. Jagex exposes no log contents, so this reads the
// snapshot the Leagues Tasks RuneLite plugin uploads to this tracker — a 404
// means the player hasn't synced, which we show as help rather than an error.

import { fmt, fetchJson, errorMessage, onEnterOrClick, escapeHtml, fmtSyncedAt, syncSetupStepsHtml } from './format.js';
import { prefillUsername } from './session.js';
import type { CollectionLogData, CollectionGroup, CollectionCategory, ApiErrorBody } from './types.js';

const usernameInput = document.getElementById('username') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn')!;
const statusEl = document.getElementById('status')!;
const syncHelpEl = document.getElementById('syncHelp') as HTMLElement;
const resultEl = document.getElementById('result') as HTMLElement;
const groupTabsEl = document.getElementById('groupTabs')!;
const groupsEl = document.getElementById('groups')!;
const gridTitleEl = document.getElementById('gridTitle')!;
const itemGridEl = document.getElementById('itemGrid')!;

prefillUsername(usernameInput);

const SYNC_HELP_HTML = `
  <p><strong>No synced collection log found for this name.</strong> Unlike quests and tasks, the log can only be read while its interface is open:</p>
  <ol>${syncSetupStepsHtml('the in-game Collection Log Sync button (open the log first &mdash; there is no sidebar Collection Log button)')}
  </ol>
  <p>Once you&apos;ve synced, search for your name again here, or just reload this page and search again.</p>`;

let groupsData: CollectionGroup[] = [];
let categoriesByKey = new Map<string, CollectionCategory>();
let selectedGroup = '';
type ProgressFilter = 'all' | 'not-started' | 'started' | 'complete';
let progressFilter: ProgressFilter = 'all';

const FILTER_TABS: { key: ProgressFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'not-started', label: 'Not Started' },
  { key: 'started', label: 'Started' },
  { key: 'complete', label: 'Completed' }
];

// Unstarted stays default; any progress is darker yellow; full clear is green.
function pillProgressClass(c: CollectionCategory): string {
  if (c.total > 0 && c.obtained >= c.total) return 'complete';
  if (c.obtained > 0) return 'started';
  return '';
}

function matchesProgressFilter(c: CollectionCategory): boolean {
  if (progressFilter === 'all') return true;
  const progress = pillProgressClass(c);
  if (progressFilter === 'not-started') return progress === '';
  return progress === progressFilter;
}

function renderGroupPills(groupName: string): void {
  const group = groupsData.find((g) => g.group === groupName);
  if (!group) return;
  const categories = group.categories.filter(matchesProgressFilter);
  if (!categories.length) {
    groupsEl.innerHTML = '<p class="status">No categories match this filter.</p>';
    return;
  }
  groupsEl.innerHTML = categories.map((c) => {
    const progress = pillProgressClass(c);
    const cls = progress ? `cl-pill ${progress}` : 'cl-pill';
    return `<button class="${cls}" data-key="${escapeHtml(c.key)}">${escapeHtml(c.name)} <span class="cl-count">${c.obtained}/${c.total}</span></button>`;
  }).join('');
}

function syncTabActive(): void {
  groupTabsEl.querySelectorAll<HTMLButtonElement>('button[data-group]').forEach((b) => {
    b.classList.toggle('active', b.dataset.group === selectedGroup);
  });
  groupTabsEl.querySelectorAll<HTMLButtonElement>('button[data-filter]').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === progressFilter);
  });
}

function selectGroupTab(groupName: string): void {
  selectedGroup = groupName;
  syncTabActive();
  renderGroupPills(groupName);
}

function selectProgressFilter(filter: ProgressFilter): void {
  progressFilter = filter;
  syncTabActive();
  renderGroupPills(selectedGroup);
}

// Rebuild group tabs + the category lookup map after a successful fetch.
function setGroups(groups: CollectionGroup[]): void {
  groupsData = groups;
  categoriesByKey = new Map();
  groups.forEach((g) => g.categories.forEach((c) => categoriesByKey.set(c.key, c)));
  progressFilter = 'all';

  const groupButtons = groups.map((g, i) => `
    <button data-group="${escapeHtml(g.group)}" class="${i === 0 ? 'active' : ''}">${escapeHtml(g.group)}</button>
  `);
  const filterButtons = FILTER_TABS.map((f) => `
    <button data-filter="${f.key}">${f.label}</button>
  `);
  groupTabsEl.innerHTML = [...groupButtons, '<span class="cl-filter-sep" aria-hidden="true"></span>', ...filterButtons].join('');

  selectGroupTab(groups[0]!.group);
}

function renderCategoryGrid(category: CollectionCategory): void {
  gridTitleEl.textContent = `${category.name} (${category.obtained}/${category.total})`;

  document.querySelectorAll<HTMLButtonElement>('.cl-pill').forEach((b) => b.classList.toggle('active', b.dataset.key === category.key));

  itemGridEl.innerHTML = category.items.map((item) => `
    <div class="cl-slot ${item.count > 0 ? 'obtained' : 'missing'}">
      <img src="${item.icon}" alt="" loading="lazy" />
      <span class="name">${escapeHtml(item.name)}</span>
      ${item.count > 1 ? `<span class="count">&times;${fmt(item.count)}</span>` : ''}
    </div>
  `).join('');

  gridTitleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

groupTabsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) return;
  if (btn.dataset.filter) {
    selectProgressFilter(btn.dataset.filter as ProgressFilter);
    return;
  }
  if (btn.dataset.group) selectGroupTab(btn.dataset.group);
});

groupsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.cl-pill');
  if (!btn) return;
  const category = categoriesByKey.get(btn.dataset.key!);
  if (category) renderCategoryGrid(category);
});

async function search(): Promise<void> {
  const username = usernameInput.value.trim();
  if (!username) return;

  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');
  syncHelpEl.hidden = true;
  resultEl.hidden = true;

  try {
    const { ok, status, data } = await fetchJson<CollectionLogData & ApiErrorBody>(`/api/collectionlog/${encodeURIComponent(username)}`);

    // Never synced — show the how-to instead of a red error.
    if (status === 404) {
      statusEl.textContent = '';
      syncHelpEl.innerHTML = SYNC_HELP_HTML;
      syncHelpEl.hidden = false;
      return;
    }
    if (!ok) throw new Error(data.error || 'Lookup failed');

    document.getElementById('itemsObtained')!.textContent = `${fmt(data.itemsObtained)} / ${fmt(data.itemsAvailable)}`;
    document.getElementById('categoriesFinished')!.textContent = `${fmt(data.categoriesFinished)} / ${fmt(data.categoriesAvailable)}`;
    document.getElementById('lastSynced')!.textContent = fmtSyncedAt(data.syncedAt);

    setGroups(data.groups);

    // Grid starts empty until a category is picked.
    gridTitleEl.textContent = 'Pick a category below to see its items';
    itemGridEl.innerHTML = '';

    statusEl.textContent = '';
    resultEl.hidden = false;
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Lookup failed');
    statusEl.classList.add('error');
  }
}

onEnterOrClick(usernameInput, searchBtn, search);
