// Leagues task progress from the RuneLite plugin sync endpoint. Region,
// difficulty, and activity type come from the server (see
// src/lib/leaguetasks.ts) - the same three filter dimensions the Leagues
// Task Randomizer plugin itself filters by, each independent and defaulting
// to "All".

import {
  fmt, fetchJson, errorMessage, onEnterOrClick, escapeHtml, syncSetupStepsHtml,
  fmtSyncedAt, wireFilterGroup, markNarrowedDimensions
} from './format.js';
import { prefillUsername } from './identity.js';
import './chrome.js';
import type { LeaguesTasksData, CompletedTaskWithMeta, ApiErrorBody } from './types.js';
import { matchesTaskFilters, TASK_FILTER_ALL } from './leaguesFilters.js';

const usernameInput = document.getElementById('username') as HTMLInputElement;
const refreshBtn = document.getElementById('refreshBtn')!;
const statusEl = document.getElementById('status')!;
const syncHelpEl = document.getElementById('syncHelp') as HTMLElement;
const resultEl = document.getElementById('result') as HTMLElement;
const taskListEl = document.getElementById('taskList')!;
const taskFilterTabsEl = document.getElementById('taskFilterTabs')!;
const taskRegionFiltersEl = document.getElementById('taskRegionFilters')!;
const taskDifficultyFiltersEl = document.getElementById('taskDifficultyFilters')!;
const taskActivityTypeFiltersEl = document.getElementById('taskActivityTypeFilters')!;

prefillUsername(usernameInput);

const SYNC_HELP_HTML = `
  <p><strong>No synced leagues data found for this name.</strong> Progress only appears after syncing from the Leagues Task Randomizer plugin at least once:</p>
  <ol>${syncSetupStepsHtml('Sync Tasks or Sync Everything')}
  </ol>
  <p>Then click <strong>Update</strong> here to load the latest snapshot.</p>`;

// ---- Region / Difficulty / Activity Type filters ----
// Same two-tier pattern as the Quests tab: a top strip picks which
// dimension's options are showing, and only that one option row is visible.
// All three filters stay applied either way - hiding a row doesn't clear it,
// so the dot marker on the top strip is what tells you a hidden row is still
// narrowing the list. Unlike the Quests tab's filter tabs (a fixed, known set
// of options), region/difficulty/activityType option buttons come from the
// server response and have to be (re)built after every load.

const ALL = TASK_FILTER_ALL;
type TaskFilterDimension = 'region' | 'difficulty' | 'activityType';

const TASK_DIMENSION_TABS: { key: TaskFilterDimension; label: string }[] = [
  { key: 'region', label: 'Region' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'activityType', label: 'Activity Type' }
];

let tasksData: CompletedTaskWithMeta[] = [];
const activeFilter: Record<TaskFilterDimension, string> = { region: ALL, difficulty: ALL, activityType: ALL };

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
  group.setOptions([ALL, ...values].map((v) => ({ key: v, label: v })));
  group.select(ALL);
}

const TASK_OPTION_ROWS: Record<TaskFilterDimension, HTMLElement> = {
  region: taskRegionFiltersEl,
  difficulty: taskDifficultyFiltersEl,
  activityType: taskActivityTypeFiltersEl
};

// Gold dot on a top-tier tab whose filter isn't 'All', so a narrowed row
// that's currently hidden doesn't look like the list is just unfiltered.
function markActiveDimensions(): void {
  markNarrowedDimensions<TaskFilterDimension>(taskFilterTabsEl, (dimension) => activeFilter[dimension] !== ALL);
}

// The top strip's own button list is fixed (unlike the option rows below it,
// which are rebuilt from server data), so it reuses the same wiring as the
// Quests tab's dimension strip.
const selectFilterDimension = wireFilterGroup(taskFilterTabsEl, TASK_DIMENSION_TABS, (key) => {
  for (const dimension of Object.keys(TASK_OPTION_ROWS) as TaskFilterDimension[]) {
    TASK_OPTION_ROWS[dimension].hidden = dimension !== key;
  }
}, renderTaskList).select;

function matchesFilters(task: CompletedTaskWithMeta): boolean {
  return matchesTaskFilters(task, activeFilter, ALL);
}

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
  return region === 'Unknown' ? 'unknown' : 'region';
}
function difficultyTagClass(difficulty: string): string {
  return difficulty === 'Unknown' ? 'unknown' : `difficulty-${slug(difficulty)}`;
}
function activityTagClass(activityType: string): string {
  return activityType === 'Unknown' ? 'unknown' : `activity-${slug(activityType)}`;
}

// Row pills use short labels where the full activity type is too long.
function activityTagLabel(activityType: string): string {
  return activityType === 'Combat Achievements' ? 'CA' : activityType;
}

function renderTaskList(): void {
  const tasks = tasksData.filter(matchesFilters);

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
  document.getElementById('completedCount')!.textContent = fmt(data.completedTasks.length);
  document.getElementById('lastSynced')!.textContent = fmtSyncedAt(data.syncedAt);

  tasksData = data.completedTasks;

  // Rebuilding each row resets its selection to "All" and reruns the list,
  // so this alone is enough to reset filters and render for a fresh search.
  setFilterOptions('region', data.filters.regions);
  setFilterOptions('difficulty', data.filters.difficulties);
  setFilterOptions('activityType', data.filters.activityTypes);

  // Also reset which dimension tab is showing, same as the Quests tab does
  // on every fresh search.
  selectFilterDimension('region');
}

async function refresh(): Promise<void> {
  const username = usernameInput.value.trim();
  if (!username) return;

  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');
  syncHelpEl.hidden = true;
  resultEl.hidden = true;

  try {
    const { ok, status, data } = await fetchJson<LeaguesTasksData & ApiErrorBody>(
      `/api/leagues/${encodeURIComponent(username)}`,
    );

    if (status === 404) {
      statusEl.textContent = '';
      syncHelpEl.innerHTML = SYNC_HELP_HTML;
      syncHelpEl.hidden = false;
      return;
    }
    if (!ok) throw new Error(data.error || 'Update failed');

    renderTasks(data);
    statusEl.textContent = '';
    resultEl.hidden = false;
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Update failed');
    statusEl.classList.add('error');
  }
}

onEnterOrClick(usernameInput, refreshBtn, () => void refresh());
window.addEventListener('osrs-session-change', () => prefillUsername(usernameInput));
