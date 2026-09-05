import { fmt, escapeHtml, syncSetupStepsHtml } from '../format.js';
import type { CombatAchievementData, CombatAchievementTaskView, CombatAchievementGroup } from '../types.js';
import { loadSyncedTab } from './context.js';
import type { CharacterTabContext } from './context.js';

const CA_SYNC_HELP_HTML = `
  <p><strong>No synced combat achievement data found for this name.</strong> Combat achievements come from the Leagues Tasks RuneLite plugin:</p>
  <ol>${syncSetupStepsHtml('Sync Combat Achievements')}
  </ol>
  <p>Then search for your name again here.</p>`;

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

function caGroupProgressClass(group: CombatAchievementGroup): string {
  if (group.total > 0 && group.complete >= group.total) return 'complete';
  if (group.complete > 0) return 'started';
  return '';
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
        <span class="${task.complete ? 'quest-state cl-pill complete' : 'quest-state cl-pill'}">${task.complete ? 'Complete' : 'Incomplete'}</span>
      </span>
    </li>
  `).join('');
}

function syncCaTabsActive(): void {
  caGroupPillsEl.querySelectorAll<HTMLButtonElement>('button[data-group]').forEach((b) => {
    b.classList.toggle('active', b.dataset.group === caSelectedGroup);
  });
  caCompletionFiltersEl.querySelectorAll<HTMLButtonElement>('button[data-filter]').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === caCompletionFilter);
  });
}

function renderCaGroupPills(): void {
  const allComplete = caGroupsData.reduce((sum, g) => sum + g.complete, 0);
  const allTotal = caGroupsData.reduce((sum, g) => sum + g.total, 0);
  const allProgress = allTotal > 0 && allComplete >= allTotal ? 'complete' : allComplete > 0 ? 'started' : '';
  const allCls = allProgress ? `cl-pill ${allProgress}` : 'cl-pill';

  const pills = [
    `<button class="${allCls}${caSelectedGroup === 'all' ? ' active' : ''}" data-group="all">All <span class="cl-count">${allComplete}/${allTotal}</span></button>`,
    ...caGroupsData.map((group) => {
      const progress = caGroupProgressClass(group);
      const cls = progress ? `cl-pill ${progress}` : 'cl-pill';
      const active = group.key === caSelectedGroup ? ' active' : '';
      return `<button class="${cls}${active}" data-group="${escapeHtml(group.key)}">${escapeHtml(group.name)} <span class="cl-count">${group.complete}/${group.total}</span></button>`;
    }),
  ];
  caGroupPillsEl.innerHTML = pills.join('');
}

function selectCaGroup(group: string): void {
  caSelectedGroup = group;
  syncCaTabsActive();
  renderCaGroupPills();
  renderCaTaskList();
  updateCaGroupToggle();
}

function selectCaCompletionFilter(filter: CaCompletionFilter): void {
  caCompletionFilter = filter;
  syncCaTabsActive();
  renderCaTaskList();
}

function renderCombatAchievements(data: CombatAchievementData): void {
  caTasksData = data.tasks;
  caGroupsData = data.groups;
  document.getElementById('caPoints')!.textContent = fmt(data.summary.points);
  document.getElementById('caComplete')!.textContent = fmt(data.summary.complete);
  document.getElementById('caTotal')!.textContent = fmt(data.summary.total);

  caSelectedGroup = 'all';
  caCompletionFilter = 'all';
  caGroupPanelOpen = false;

  caCompletionFiltersEl.innerHTML = CA_COMPLETION_TABS.map((f, i) =>
    `<button data-filter="${f.key}"${i === 0 ? ' class="active"' : ''}>${f.label}</button>`
  ).join('');

  syncCaGroupPanel();
  renderCaGroupPills();
  renderCaTaskList();
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

  caCompletionFiltersEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-filter]');
    if (btn?.dataset.filter) selectCaCompletionFilter(btn.dataset.filter as CaCompletionFilter);
  });
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
