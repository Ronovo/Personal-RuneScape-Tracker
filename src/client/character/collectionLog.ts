import { fmt, escapeHtml, fmtSyncedAt, syncHelpHtml, wireFilterGroup, el } from '../format.js';
import type { CollectionLogData, CollectionGroup, CollectionCategory } from '../../shared/api.js';
import { loadSyncedTab, pillClass, progressClass } from './context.js';
import type { CharacterTabContext } from './context.js';

const CL_SYNC_HELP_HTML = syncHelpHtml(
  '<strong>No synced collection log found for this name.</strong> Unlike quests and tasks, the log can only be read while its interface is open:',
  'the in-game Collection Log Sync button (open the log first; there is no sidebar Collection Log button)',
  "Once you've synced, search for your name again here.");

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
let groupButtonsEl: HTMLElement;
let selectFilter: (filter: ProgressFilter) => void;
let groupsEl: HTMLElement;
let gridTitleEl: HTMLElement;
let itemGridEl: HTMLElement;

let groupsData: CollectionGroup[] = [];
let categoriesByKey = new Map<string, CollectionCategory>();
let selectedGroup = '';
let progressFilter: ProgressFilter = 'all';

function matchesProgressFilter(c: CollectionCategory): boolean {
  if (progressFilter === 'all') return true;
  const progress = progressClass(c.obtained, c.total);
  if (progressFilter === 'not-started') return progress === '';
  return progress === progressFilter;
}

function renderGroupPills(groupName: string): void {
  const group = groupsData.find((g) => g.group === groupName);
  /* c8 ignore next - the selected group always comes from the list */
  if (!group) return;
  const categories = group.categories.filter(matchesProgressFilter);
  if (!categories.length) {
    groupsEl.innerHTML = '<p class="status">No categories match this filter.</p>';
    return;
  }
  groupsEl.innerHTML = categories.map((c) =>
    `<button class="${pillClass(c.obtained, c.total)}" data-key="${escapeHtml(c.key)}">${escapeHtml(c.name)} <span class="cl-count">${c.obtained}/${c.total}</span></button>`
  ).join('');
}

function selectGroupTab(groupName: string): void {
  selectedGroup = groupName;
  groupButtonsEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.group === selectedGroup);
  });
  renderGroupPills(groupName);
}

function setGroups(groups: CollectionGroup[]): void {
  groupsData = groups;
  categoriesByKey = new Map();
  groups.forEach((g) => g.categories.forEach((c) => categoriesByKey.set(c.key, c)));
  groupButtonsEl.innerHTML = groups
    .map((g) => `<button data-group="${escapeHtml(g.group)}">${escapeHtml(g.group)}</button>`)
    .join('');
  selectedGroup = groups[0]!.group;
  selectFilter('all');
  selectGroupTab(selectedGroup);
}

function renderCategoryGrid(category: CollectionCategory): void {
  gridTitleEl.textContent = `${category.name} (${category.obtained}/${category.total})`;

  groupsEl.querySelectorAll<HTMLButtonElement>('.cl-pill').forEach((b) => b.classList.toggle('active', b.dataset.key === category.key));

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
  groupsEl = refs.groupsEl;
  gridTitleEl = refs.gridTitleEl;
  itemGridEl = refs.itemGridEl;

  // Group buttons and progress filters share one row, split by a separator.
  refs.groupTabsEl.innerHTML =
    '<span class="cl-row-part"></span><span class="cl-filter-sep" aria-hidden="true"></span><span class="cl-row-part"></span>';
  const [groupPart, filterPart] = refs.groupTabsEl.querySelectorAll<HTMLElement>('.cl-row-part');
  groupButtonsEl = groupPart!;
  selectFilter = wireFilterGroup(filterPart!, CL_FILTER_TABS, (key) => { progressFilter = key; },
    () => renderGroupPills(selectedGroup)).select;

  groupButtonsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-group]');
    if (btn?.dataset.group) selectGroupTab(btn.dataset.group);
  });

  groupsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.cl-pill');
    if (!btn) return;
    const category = categoriesByKey.get(btn.dataset.key!);
    if (category) renderCategoryGrid(category);
  });
}

function renderCollectionLog(data: CollectionLogData): void {
  el('itemsObtained').textContent = `${fmt(data.itemsObtained)} / ${fmt(data.itemsAvailable)}`;
  el('categoriesFinished').textContent = `${fmt(data.categoriesFinished)} / ${fmt(data.categoriesAvailable)}`;
  el('lastSynced').textContent = fmtSyncedAt(data.syncedAt);

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
