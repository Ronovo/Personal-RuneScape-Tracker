import { fmt, escapeHtml, fmtSyncedAt, syncSetupStepsHtml } from '../format.js';
import type { CollectionLogData, CollectionGroup, CollectionCategory } from '../types.js';
import { loadSyncedTab } from './context.js';
import type { CharacterTabContext } from './context.js';

const CL_SYNC_HELP_HTML = `
  <p><strong>No synced collection log found for this name.</strong> Unlike quests and tasks, the log can only be read while its interface is open:</p>
  <ol>${syncSetupStepsHtml('the in-game Collection Log Sync button (open the log first — there is no sidebar Collection Log button)')}
  </ol>
  <p>Once you've synced, search for your name again here.</p>`;

type ProgressFilter = 'all' | 'not-started' | 'started' | 'complete';

const CL_FILTER_TABS: { key: ProgressFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'not-started', label: 'Not Started' },
  { key: 'started', label: 'Started' },
  { key: 'complete', label: 'Completed' }
];

export interface CollectionLogTabRefs {
  syncHelpEl: HTMLElement;
  resultEl: HTMLElement;
  groupTabsEl: HTMLElement;
  groupsEl: HTMLElement;
  gridTitleEl: HTMLElement;
  itemGridEl: HTMLElement;
}

let syncHelpEl: HTMLElement;
let resultEl: HTMLElement;
let groupTabsEl: HTMLElement;
let groupsEl: HTMLElement;
let gridTitleEl: HTMLElement;
let itemGridEl: HTMLElement;

let groupsData: CollectionGroup[] = [];
let categoriesByKey = new Map<string, CollectionCategory>();
let selectedGroup = '';
let progressFilter: ProgressFilter = 'all';

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

function syncCollectionTabActive(): void {
  groupTabsEl.querySelectorAll<HTMLButtonElement>('button[data-group]').forEach((b) => {
    b.classList.toggle('active', b.dataset.group === selectedGroup);
  });
  groupTabsEl.querySelectorAll<HTMLButtonElement>('button[data-filter]').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === progressFilter);
  });
}

function selectGroupTab(groupName: string): void {
  selectedGroup = groupName;
  syncCollectionTabActive();
  renderGroupPills(groupName);
}

function selectProgressFilter(filter: ProgressFilter): void {
  progressFilter = filter;
  syncCollectionTabActive();
  renderGroupPills(selectedGroup);
}

function setGroups(groups: CollectionGroup[]): void {
  groupsData = groups;
  categoriesByKey = new Map();
  groups.forEach((g) => g.categories.forEach((c) => categoriesByKey.set(c.key, c)));
  progressFilter = 'all';

  const groupButtons = groups.map((g, i) => `
    <button data-group="${escapeHtml(g.group)}" class="${i === 0 ? 'active' : ''}">${escapeHtml(g.group)}</button>
  `);
  const filterButtons = CL_FILTER_TABS.map((f) => `
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
      <img src="${escapeHtml(item.icon)}" alt="" loading="lazy" />
      <span class="name">${escapeHtml(item.name)}</span>
    </div>
  `).join('');

  gridTitleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function initCollectionLogTab(refs: CollectionLogTabRefs): void {
  syncHelpEl = refs.syncHelpEl;
  resultEl = refs.resultEl;
  groupTabsEl = refs.groupTabsEl;
  groupsEl = refs.groupsEl;
  gridTitleEl = refs.gridTitleEl;
  itemGridEl = refs.itemGridEl;

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
}

function renderCollectionLog(data: CollectionLogData): void {
  document.getElementById('itemsObtained')!.textContent = `${fmt(data.itemsObtained)} / ${fmt(data.itemsAvailable)}`;
  document.getElementById('categoriesFinished')!.textContent = `${fmt(data.categoriesFinished)} / ${fmt(data.categoriesAvailable)}`;
  document.getElementById('lastSynced')!.textContent = fmtSyncedAt(data.syncedAt);

  setGroups(data.groups);

  gridTitleEl.textContent = 'Pick a category below to see its items';
  itemGridEl.innerHTML = '';
}

export function loadCollectionLog(username: string, ctx: CharacterTabContext): Promise<void> {
  return loadSyncedTab<CollectionLogData>({
    url: `/api/collectionlog/${encodeURIComponent(username)}`,
    ctx,
    resultEl,
    syncHelpEl,
    syncHelpHtml: CL_SYNC_HELP_HTML,
    errorText: 'Failed to load collection log',
    render: renderCollectionLog,
  });
}
