// Leagues task progress from the RuneLite plugin sync endpoint. Region,
// difficulty, and activity type come from the server (see
// src/lib/leaguetasks.ts) - the same three filter dimensions the Leagues
// Task Randomizer plugin itself filters by, each independent and defaulting
// to "All".

import {
  fmt, onEnterOrClick, escapeHtml, syncHelpHtml, latestRequest,
  fmtSyncedAt, wireFilterGroup, markNarrowedDimensions, el} from './format.js';
import { prefillUsername, SESSION_CHANGE_EVENT } from './identity.js';
import { loadSyncedTab } from './character/context.js';
import './chrome.js';
import type { LeaguesTasksData, CompletedTaskWithMeta } from '../shared/api.js';
import { UNKNOWN_LABEL } from '../shared/api.js';
import { matchesTaskFilters, TASK_FILTER_ALL } from './leaguesFilters.js';

const usernameInput = el<HTMLInputElement>('username');
const refreshBtn = el('refreshBtn');
const statusEl = el('status');
const syncHelpEl = el('syncHelp');
const resultEl = el('result');
const taskListEl = el('taskList');
const taskFilterTabsEl = el('taskFilterTabs');
const taskRegionFiltersEl = el('taskRegionFilters');
const taskDifficultyFiltersEl = el('taskDifficultyFilters');
const taskActivityTypeFiltersEl = el('taskActivityTypeFilters');

prefillUsername(usernameInput);

const SYNC_HELP_HTML = syncHelpHtml(
  '<strong>No synced leagues data found for this name.</strong> Tasks are completed in the Leagues Tasks RuneLite plugin and sent here by the Ronovo&apos;s Sync Tool plugin, so progress only appears after syncing at least once:',
  'Sync Tasks or Sync Everything',
  'Then click <strong>Update</strong> here to load the latest snapshot.');

// ---- Region / Difficulty / Activity Type filters ----
// A top strip picks which dimension's options are showing. All three filters
// stay applied when their row is hidden, and the strip's dot marks one that is.
// The option buttons come from the server response, so they are rebuilt after
// every load.

type TaskFilterDimension = 'region' | 'difficulty' | 'activityType';

const TASK_DIMENSION_TABS: { key: TaskFilterDimension; label: string }[] = [
  { key: 'region', label: 'Region' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'activityType', label: 'Activity Type' }
];

let tasksData: CompletedTaskWithMeta[] = [];
const activeFilter: Record<TaskFilterDimension, string> = {
  region: TASK_FILTER_ALL, difficulty: TASK_FILTER_ALL, activityType: TASK_FILTER_ALL
};

// One filter row per dimension. Options here are whatever the server returned,
// so each row is rebuilt on every load - hence setOptions rather than a fixed
// list. Value and label are the same string ("Karamja", "Elite").
function makeFilterGroup(el: HTMLElement, dimension: TaskFilterDimension) {
  return wireFilterGroup<string>(el, [], (value) => {
    activeFilter[dimension] = value;
    markActiveDimensions();
  }, renderTaskList);
}

const filterGroups: Record<TaskFilterDimension, ReturnType<typeof makeFilterGroup>> = {
  region: makeFilterGroup(taskRegionFiltersEl, 'region'),
  difficulty: makeFilterGroup(taskDifficultyFiltersEl, 'difficulty'),
  activityType: makeFilterGroup(taskActivityTypeFiltersEl, 'activityType')
};

// Rebuilding a row resets its selection to "All" and reruns the list.
function setFilterOptions(dimension: TaskFilterDimension, values: string[]): void {
  const group = filterGroups[dimension];
  group.setOptions([TASK_FILTER_ALL, ...values].map((v) => ({ key: v, label: v })));
  group.select(TASK_FILTER_ALL);
}

const TASK_OPTION_ROWS: Record<TaskFilterDimension, HTMLElement> = {
  region: taskRegionFiltersEl,
  difficulty: taskDifficultyFiltersEl,
  activityType: taskActivityTypeFiltersEl
};

function markActiveDimensions(): void {
  markNarrowedDimensions<TaskFilterDimension>(taskFilterTabsEl, (dimension) => activeFilter[dimension] !== TASK_FILTER_ALL);
}

const selectFilterDimension = wireFilterGroup(taskFilterTabsEl, TASK_DIMENSION_TABS, (key) => {
  for (const dimension of Object.keys(TASK_OPTION_ROWS) as TaskFilterDimension[]) {
    TASK_OPTION_ROWS[dimension].hidden = dimension !== key;
  }
}, renderTaskList).select;

// Turns "Combat/Magic" -> "combat-magic" to match the modifier class names
// in style.css (.task-tag.activity-combat-magic etc).
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Region is one color regardless of value (see style.css) - only
// difficulty/activityType vary their class by value. "Unknown" (a taskId
// the imported metadata doesn't recognize) always gets the shared neutral
// style, in any of the three slots.
function regionTagClass(region: string): string {
  return region === UNKNOWN_LABEL ? 'unknown' : 'region';
}
function difficultyTagClass(difficulty: string): string {
  return difficulty === UNKNOWN_LABEL ? 'unknown' : `difficulty-${slug(difficulty)}`;
}
function activityTagClass(activityType: string): string {
  return activityType === UNKNOWN_LABEL ? 'unknown' : `activity-${slug(activityType)}`;
}

// Row pills use short labels where the full activity type is too long.
function activityTagLabel(activityType: string): string {
  return activityType === 'Combat Achievements' ? 'CA' : activityType;
}

function renderTaskList(): void {
  const tasks = tasksData.filter((task) => matchesTaskFilters(task, activeFilter));

  if (!tasks.length) {
    taskListEl.innerHTML = '<li class="status">No completed tasks match this filter.</li>';
    return;
  }

  taskListEl.innerHTML = tasks.map((task) => `
    <li>
      <strong>${escapeHtml(task.name)}</strong>
      <span class="task-meta">
        <span class="task-tag ${activityTagClass(task.activityType)}">${escapeHtml(activityTagLabel(task.activityType))}</span>
        <span class="task-tag ${regionTagClass(task.region)}">${escapeHtml(task.region)}</span>
        <span class="task-tag ${difficultyTagClass(task.difficulty)}">${escapeHtml(task.difficulty)}</span>
      </span>
    </li>
  `).join('');
}

function renderTasks(data: LeaguesTasksData): void {
  el('completedCount').textContent = fmt(data.completedTasks.length);
  el('lastSynced').textContent = fmtSyncedAt(data.syncedAt);

  tasksData = data.completedTasks;

  setFilterOptions('region', data.filters.regions);
  setFilterOptions('difficulty', data.filters.difficulties);
  setFilterOptions('activityType', data.filters.activityTypes);

  selectFilterDimension('region');
}

const startRefresh = latestRequest();

async function refresh(): Promise<void> {
  const username = usernameInput.value.trim();
  if (!username) return;
  const isCurrent = startRefresh();

  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');
  await loadSyncedTab<LeaguesTasksData>({
    url: `/api/leagues/${encodeURIComponent(username)}`,
    ctx: { statusEl, isCurrent },
    resultEl,
    syncHelpEl,
    syncHelpHtml: SYNC_HELP_HTML,
    errorText: 'Update failed',
    render: (data) => {
      statusEl.textContent = '';
      renderTasks(data);
    },
  });
  if (isCurrent() && !syncHelpEl.hidden) statusEl.textContent = '';
}

onEnterOrClick(usernameInput, refreshBtn, () => void refresh());
window.addEventListener(SESSION_CHANGE_EVENT, () => prefillUsername(usernameInput));
