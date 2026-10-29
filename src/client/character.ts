// Character hiscores page. Username box is pre-filled from session when set.
// Skills/bosses/minigames come from Jagex; Quests, Diaries, Combat
// Achievements, and Collection Log come from the RuneLite plugin sync.

import { fmt, fetchJson, errorMessage, onEnterOrClick, latestRequest, el } from './format.js';
import { prefillUsername, SESSION_CHANGE_EVENT } from './identity.js';
import './chrome.js';
import type { HiscoresData, ApiErrorBody } from '../shared/api.js';
import { renderSkills, renderScored } from './character/hiscores.js';
import { initQuestsTab, loadQuests } from './character/quests.js';
import { initDiariesTab, loadDiaries } from './character/diaries.js';
import { initCombatAchievementsTab, loadCombatAchievements } from './character/combatAchievements.js';
import { initCollectionLogTab, loadCollectionLog } from './character/collectionLog.js';

const usernameInput = el<HTMLInputElement>('username');
const searchBtn = el('searchBtn');
const statusEl = el('status');
const resultEl = el('result');

prefillUsername(usernameInput);

initQuestsTab({
  syncHelpEl: el('questSyncHelp'),
  resultEl: el('questResult'),
  filterTabsEl: el('questFilterTabs'),
  stateFiltersEl: el('questStateFilters'),
  typeFiltersEl: el('questTypeFilters'),
  memberFiltersEl: el('questMemberFilters'),
  listEl: el('questList'),
});

initDiariesTab({
  syncHelpEl: el('diarySyncHelp'),
  resultEl: el('diaryResult'),
  areasEl: el('diaryAreas'),
});

initCombatAchievementsTab({
  syncHelpEl: el('caSyncHelp'),
  resultEl: el('caResult'),
  groupToggleEl: el<HTMLButtonElement>('caGroupToggle'),
  groupPanelEl: el('caGroupPanel'),
  groupPillsEl: el('caGroupPills'),
  completionFiltersEl: el('caCompletionFilters'),
  taskListEl: el('caTaskList'),
});

initCollectionLogTab({
  syncHelpEl: el('clSyncHelp'),
  resultEl: el('clResult'),
  groupTabsEl: el('groupTabs'),
  groupsEl: el('groups'),
  gridTitleEl: el('gridTitle'),
  itemGridEl: el('itemGrid'),
});

function activateTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>('#mainTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${tab}`));
}

document.querySelectorAll<HTMLButtonElement>('#mainTabs button').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab!));
});

const startSearch = latestRequest();

async function search(): Promise<void> {
  const username = usernameInput.value.trim();
  if (!username) return;
  const isCurrent = startSearch();

  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');
  resultEl.hidden = true;

  const tabCtx = { statusEl, isCurrent };

  try {
    const { ok, data } = await fetchJson<HiscoresData & ApiErrorBody>(`/api/hiscores/${encodeURIComponent(username)}`);
    if (!isCurrent()) return;
    if (!ok) throw new Error(data.error || 'Lookup failed');

    el('combatLevel').textContent = String(data.combatLevel);
    el('totalLevel').textContent = fmt(data.totalLevel);
    el('totalXp').textContent = fmt(data.totalXp);

    el('tab-skills').innerHTML = renderSkills(data.skills);
    el('tab-bosses').innerHTML = renderScored(data.bosses, 'Boss');
    el('tab-minigames').innerHTML = renderScored(data.minigames, 'Minigame');
    el('tab-clues').innerHTML = renderScored(data.others, 'Activity');

    statusEl.textContent = '';
    resultEl.hidden = false;

    await Promise.all([
      loadQuests(username, tabCtx),
      loadDiaries(username, tabCtx),
      loadCombatAchievements(username, tabCtx),
      loadCollectionLog(username, tabCtx),
    ]);
  } catch (err) {
    if (!isCurrent()) return;
    statusEl.textContent = errorMessage(err, 'Lookup failed');
    statusEl.classList.add('error');
  }
}

onEnterOrClick(usernameInput, searchBtn, () => void search());
window.addEventListener(SESSION_CHANGE_EVENT, () => prefillUsername(usernameInput));
