import {
  fmt, escapeHtml, syncSetupStepsHtml, wireFilterGroup, markNarrowedDimensions
} from '../format.js';
import type { QuestProgressData, QuestWithMeta, QuestState } from '../types.js';
import { loadSyncedTab } from './context.js';
import type { CharacterTabContext } from './context.js';

const QUEST_SYNC_HELP_HTML = `
  <p><strong>No synced quest data found for this name.</strong> Quests come from the Leagues Task Randomizer RuneLite plugin, not the hiscores:</p>
  <ol>${syncSetupStepsHtml('Sync Quests or Sync Everything')}
  </ol>
  <p>Then search for your name again here.</p>`;

type QuestFilter = 'all' | 'complete' | 'in-progress' | 'not-complete';

const QUEST_FILTER_TABS: { key: QuestFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'complete', label: 'Completed' },
  { key: 'in-progress', label: 'In Progress' },
  { key: 'not-complete', label: 'Not Completed' }
];

const QUEST_STATE_BY_FILTER: Record<Exclude<QuestFilter, 'all'>, QuestState> = {
  complete: 'FINISHED',
  'in-progress': 'IN_PROGRESS',
  'not-complete': 'NOT_STARTED'
};

const QUEST_STATE_LABELS: Record<QuestState, string> = {
  FINISHED: 'Completed',
  IN_PROGRESS: 'In progress',
  NOT_STARTED: 'Not completed'
};

type QuestTypeFilter = 'all' | 'miniquest' | 'quest';
const QUEST_TYPE_FILTER_TABS: { key: QuestTypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'miniquest', label: 'Miniquest' },
  { key: 'quest', label: 'Quest' }
];

type QuestMemberFilter = 'all' | 'f2p' | 'members';
const QUEST_MEMBER_FILTER_TABS: { key: QuestMemberFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'f2p', label: 'Free to Play' },
  { key: 'members', label: 'Members' }
];

const QUEST_STATE_CLASSES: Record<QuestState, string> = {
  FINISHED: 'quest-state cl-pill complete',
  IN_PROGRESS: 'quest-state cl-pill started',
  NOT_STARTED: 'quest-state cl-pill'
};

type QuestFilterDimension = 'state' | 'type' | 'members';

const QUEST_DIMENSION_TABS: { key: QuestFilterDimension; label: string }[] = [
  { key: 'state', label: 'Completion Status' },
  { key: 'type', label: 'Type' },
  { key: 'members', label: 'Membership' }
];

export interface QuestsTabRefs {
  syncHelpEl: HTMLElement;
  resultEl: HTMLElement;
  filterTabsEl: HTMLElement;
  stateFiltersEl: HTMLElement;
  typeFiltersEl: HTMLElement;
  memberFiltersEl: HTMLElement;
  listEl: HTMLElement;
}

let syncHelpEl: HTMLElement;
let resultEl: HTMLElement;
let listEl: HTMLElement;
let questFilterTabsEl: HTMLElement;

let questsData: QuestWithMeta[] = [];
let questFilter: QuestFilter = 'all';
let questTypeFilter: QuestTypeFilter = 'all';
let questMemberFilter: QuestMemberFilter = 'all';

function renderQuestList(): void {
  const quests = questsData.filter((q) =>
    (questFilter === 'all' || q.state === QUEST_STATE_BY_FILTER[questFilter]) &&
    (questTypeFilter === 'all' || q.kind === questTypeFilter) &&
    (questMemberFilter === 'all' || q.members === (questMemberFilter === 'members'))
  );

  if (!quests.length) {
    listEl.innerHTML = '<li class="status">No quests match this filter.</li>';
    return;
  }

  listEl.innerHTML = quests.map((q) => `
    <li>
      <strong>${escapeHtml(q.name)}</strong>
      <span class="quest-meta">
        <span class="quest-tag ${q.kind}">${q.kind === 'miniquest' ? 'Miniquest' : 'Quest'}</span>
        <span class="quest-tag ${q.members ? 'members' : 'f2p'}">${q.members ? 'Members' : 'F2P'}</span>
        <span class="${QUEST_STATE_CLASSES[q.state]}">${QUEST_STATE_LABELS[q.state]}</span>
      </span>
    </li>
  `).join('');
}

function markActiveDimensions(): void {
  const narrowed: Record<QuestFilterDimension, boolean> = {
    state: questFilter !== 'all',
    type: questTypeFilter !== 'all',
    members: questMemberFilter !== 'all'
  };
  markNarrowedDimensions<QuestFilterDimension>(questFilterTabsEl, (key) => narrowed[key]);
}

function renderQuests(data: QuestProgressData): void {
  questsData = data.quests;
  document.getElementById('questsComplete')!.textContent = fmt(data.summary.complete);
  document.getElementById('questsInProgress')!.textContent = fmt(data.summary.inProgress);
  document.getElementById('questsNotStarted')!.textContent = fmt(data.summary.notStarted);

  selectQuestFilter('all');
  selectTypeFilter('all');
  selectMemberFilter('all');
  selectFilterDimension('state');
}

let selectQuestFilter: (key: QuestFilter) => void;
let selectTypeFilter: (key: QuestTypeFilter) => void;
let selectMemberFilter: (key: QuestMemberFilter) => void;
let selectFilterDimension: (key: QuestFilterDimension) => void;

export function initQuestsTab(refs: QuestsTabRefs): void {
  syncHelpEl = refs.syncHelpEl;
  resultEl = refs.resultEl;
  listEl = refs.listEl;
  questFilterTabsEl = refs.filterTabsEl;

  const optionRows: Record<QuestFilterDimension, HTMLElement> = {
    state: refs.stateFiltersEl,
    type: refs.typeFiltersEl,
    members: refs.memberFiltersEl
  };

  selectQuestFilter = wireFilterGroup(refs.stateFiltersEl, QUEST_FILTER_TABS, (k) => { questFilter = k; markActiveDimensions(); }, renderQuestList).select;
  selectTypeFilter = wireFilterGroup(refs.typeFiltersEl, QUEST_TYPE_FILTER_TABS, (k) => { questTypeFilter = k; markActiveDimensions(); }, renderQuestList).select;
  selectMemberFilter = wireFilterGroup(refs.memberFiltersEl, QUEST_MEMBER_FILTER_TABS, (k) => { questMemberFilter = k; markActiveDimensions(); }, renderQuestList).select;
  selectFilterDimension = wireFilterGroup(refs.filterTabsEl, QUEST_DIMENSION_TABS, (key) => {
    for (const dimension of Object.keys(optionRows) as QuestFilterDimension[]) {
      optionRows[dimension].hidden = dimension !== key;
    }
  }, renderQuestList).select;
}

export function loadQuests(username: string, ctx: CharacterTabContext): Promise<void> {
  return loadSyncedTab<QuestProgressData>({
    url: `/api/quests/${encodeURIComponent(username)}`,
    ctx,
    resultEl,
    syncHelpEl,
    syncHelpHtml: QUEST_SYNC_HELP_HTML,
    errorText: 'Failed to load quests',
    render: renderQuests,
  });
}
