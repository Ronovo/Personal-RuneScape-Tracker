import { fmt, escapeHtml, syncHelpHtml, wireFilterGroup, el } from '../format.js';
import type { CombatAchievementData, CombatAchievementTaskView, CombatAchievementGroup } from '../../shared/api.js';
import { loadSyncedTab, pillClass } from './context.js';
import type { CharacterTabContext } from './context.js';

const CA_SYNC_HELP_HTML = syncHelpHtml(
  '<strong>No synced combat achievement data found for this name.</strong> Combat achievements come from the Ronovo&apos;s Sync Tool RuneLite plugin:',
  'Sync Combat Achievements');

type CaCompletionFilter = 'all' | 'complete' | 'incomplete';
const CA_COMPLETION_TABS: { key: CaCompletionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'complete', label: 'Complete' },
  { key: 'incomplete', label: 'Incomplete' },
];

export interface CombatAchievementsTabRefs {
  syncHelpEl: HTMLElement;
  resultEl: HTMLElement;
  groupToggleEl: HTMLButtonElement;
  groupPanelEl: HTMLElement;
  groupPillsEl: HTMLElement;
  completionFiltersEl: HTMLElement;
  taskListEl: HTMLElement;
}

let syncHelpEl: HTMLElement;
let resultEl: HTMLElement;
let caGroupToggleEl: HTMLButtonElement;
let caGroupPanelEl: HTMLElement;
let caGroupPillsEl: HTMLElement;
let caCompletionFiltersEl: HTMLElement;
let caTaskListEl: HTMLElement;

let caTasksData: CombatAchievementTaskView[] = [];
let caGroupsData: CombatAchievementGroup[] = [];
let caSelectedGroup = 'all';
let caCompletionFilter: CaCompletionFilter = 'all';
let caGroupPanelOpen = false;

function syncCaGroupPanel(): void {
  caGroupPanelEl.hidden = !caGroupPanelOpen;
  caGroupToggleEl.setAttribute('aria-expanded', String(caGroupPanelOpen));
}

function caGroupToggleLabel(): string {
  if (caGroupPanelOpen) return 'Hide boss filter';
  if (caSelectedGroup === 'all') return 'Filter by Boss';
  const group = caGroupsData.find((g) => g.key === caSelectedGroup);
  /* c8 ignore next - each lookup resets the boss filter to All, so a selected boss is always in the list */
  return group ? `Filter by Boss: ${group.name}` : 'Filter by Boss';
}

function updateCaGroupToggle(): void {
  caGroupToggleEl.textContent = caGroupToggleLabel();
}

function toggleCaGroupPanel(): void {
  caGroupPanelOpen = !caGroupPanelOpen;
  syncCaGroupPanel();
  updateCaGroupToggle();
}

function renderCaTaskList(): void {
  const tasks = caTasksData.filter((task) =>
    (caSelectedGroup === 'all' || task.groupKey === caSelectedGroup) &&
    (caCompletionFilter === 'all' ||
      (caCompletionFilter === 'complete' ? task.complete : !task.complete))
  );

  if (!tasks.length) {
    caTaskListEl.innerHTML = '<li class="status">No tasks match this filter.</li>';
    return;
  }

  caTaskListEl.innerHTML = tasks.map((task) => `
    <li>
      <strong>${escapeHtml(task.name)}</strong>
      <span class="task-meta">
        <span class="quest-tag quest">${escapeHtml(task.group)}</span>
        ${task.tier ? `<span class="quest-tag members">${escapeHtml(task.tier)}</span>` : ''}
        <span class="quest-state ${pillClass(task.complete ? 1 : 0, 1)}">${task.complete ? 'Complete' : 'Incomplete'}</span>
      </span>
    </li>
  `).join('');
}

function renderCaGroupPills(): void {
  const allComplete = caGroupsData.reduce((sum, g) => sum + g.complete, 0);
  const allTotal = caGroupsData.reduce((sum, g) => sum + g.total, 0);
  const pills = [
    `<button class="${pillClass(allComplete, allTotal)}${caSelectedGroup === 'all' ? ' active' : ''}" data-group="all">All <span class="cl-count">${allComplete}/${allTotal}</span></button>`,
    ...caGroupsData.map((group) => {
      const active = group.key === caSelectedGroup ? ' active' : '';
      return `<button class="${pillClass(group.complete, group.total)}${active}" data-group="${escapeHtml(group.key)}">${escapeHtml(group.name)} <span class="cl-count">${group.complete}/${group.total}</span></button>`;
    }),
  ];
  caGroupPillsEl.innerHTML = pills.join('');
}

function selectCaGroup(group: string): void {
  caSelectedGroup = group;
  renderCaGroupPills();
  renderCaTaskList();
  updateCaGroupToggle();
}

let selectCaCompletionFilter: (filter: CaCompletionFilter) => void;

function renderCombatAchievements(data: CombatAchievementData): void {
  caTasksData = data.tasks;
  caGroupsData = data.groups;
  el('caPoints').textContent = fmt(data.summary.points);
  el('caComplete').textContent = fmt(data.summary.complete);
  el('caTotal').textContent = fmt(data.summary.total);

  caSelectedGroup = 'all';
  caGroupPanelOpen = false;

  syncCaGroupPanel();
  renderCaGroupPills();
  selectCaCompletionFilter('all');
  updateCaGroupToggle();
}

export function initCombatAchievementsTab(refs: CombatAchievementsTabRefs): void {
  syncHelpEl = refs.syncHelpEl;
  resultEl = refs.resultEl;
  caGroupToggleEl = refs.groupToggleEl;
  caGroupPanelEl = refs.groupPanelEl;
  caGroupPillsEl = refs.groupPillsEl;
  caCompletionFiltersEl = refs.completionFiltersEl;
  caTaskListEl = refs.taskListEl;

  caGroupToggleEl.addEventListener('click', toggleCaGroupPanel);

  caGroupPillsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-group]');
    if (btn?.dataset.group) selectCaGroup(btn.dataset.group);
  });

  selectCaCompletionFilter = wireFilterGroup(caCompletionFiltersEl, CA_COMPLETION_TABS,
    (key) => { caCompletionFilter = key; }, renderCaTaskList).select;
}

export function loadCombatAchievements(username: string, ctx: CharacterTabContext): Promise<void> {
  return loadSyncedTab<CombatAchievementData>({
    url: `/api/combatachievements/${encodeURIComponent(username)}`,
    ctx,
    resultEl,
    syncHelpEl,
    syncHelpHtml: CA_SYNC_HELP_HTML,
    errorText: 'Failed to load combat achievements',
    render: renderCombatAchievements,
  });
}
