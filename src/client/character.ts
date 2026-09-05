// Character hiscores page. Username box is pre-filled from session when set.
// Skills/bosses/minigames come from Jagex; Quests, Diaries, Combat
// Achievements, and Collection Log come from the RuneLite plugin sync.

import { fmt, fetchJson, errorMessage, onEnterOrClick } from './format.js';
import { prefillUsername } from './identity.js';
import './chrome.js';
import type { HiscoresData, ApiErrorBody } from './types.js';
import { renderSkills, renderScored } from './character/hiscores.js';
import { initQuestsTab, loadQuests } from './character/quests.js';
import { initDiariesTab, loadDiaries } from './character/diaries.js';
import { initCombatAchievementsTab, loadCombatAchievements } from './character/combatAchievements.js';
import { initCollectionLogTab, loadCollectionLog } from './character/collectionLog.js';

const usernameInput = document.getElementById('username') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn')!;
const statusEl = document.getElementById('status')!;
const resultEl = document.getElementById('result') as HTMLElement;

prefillUsername(usernameInput);

initQuestsTab({
  syncHelpEl: document.getElementById('questSyncHelp') as HTMLElement,
  resultEl: document.getElementById('questResult') as HTMLElement,
  filterTabsEl: document.getElementById('questFilterTabs')!,
  stateFiltersEl: document.getElementById('questStateFilters')!,
  typeFiltersEl: document.getElementById('questTypeFilters')!,
  memberFiltersEl: document.getElementById('questMemberFilters')!,
  listEl: document.getElementById('questList')!,
});

initDiariesTab({
  syncHelpEl: document.getElementById('diarySyncHelp') as HTMLElement,
  resultEl: document.getElementById('diaryResult') as HTMLElement,
  areasEl: document.getElementById('diaryAreas')!,
});

initCombatAchievementsTab({
  syncHelpEl: document.getElementById('caSyncHelp') as HTMLElement,
  resultEl: document.getElementById('caResult') as HTMLElement,
  groupToggleEl: document.getElementById('caGroupToggle') as HTMLButtonElement,
  groupPanelEl: document.getElementById('caGroupPanel') as HTMLElement,
  groupPillsEl: document.getElementById('caGroupPills')!,
  completionFiltersEl: document.getElementById('caCompletionFilters')!,
  taskListEl: document.getElementById('caTaskList')!,
});

initCollectionLogTab({
  syncHelpEl: document.getElementById('clSyncHelp') as HTMLElement,
  resultEl: document.getElementById('clResult') as HTMLElement,
  groupTabsEl: document.getElementById('groupTabs')!,
  groupsEl: document.getElementById('groups')!,
  gridTitleEl: document.getElementById('gridTitle')!,
  itemGridEl: document.getElementById('itemGrid')!,
});

function activateTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>('#mainTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${tab}`));
}

document.querySelectorAll<HTMLButtonElement>('#mainTabs button').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab!));
});

async function search(): Promise<void> {
  const username = usernameInput.value.trim();
  if (!username) return;

  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');
  resultEl.hidden = true;

  const tabCtx = { statusEl };

  try {
    const { ok, data } = await fetchJson<HiscoresData & ApiErrorBody>(`/api/hiscores/${encodeURIComponent(username)}`);
    if (!ok) throw new Error(data.error || 'Lookup failed');

    document.getElementById('combatLevel')!.textContent = String(data.combatLevel);
    document.getElementById('totalLevel')!.textContent = fmt(data.totalLevel);
    document.getElementById('totalXp')!.textContent = fmt(data.totalXp);

    document.getElementById('tab-skills')!.innerHTML = renderSkills(data.skills);
    document.getElementById('tab-bosses')!.innerHTML = renderScored(data.bosses, 'Boss');
    document.getElementById('tab-minigames')!.innerHTML = renderScored(data.minigames, 'Minigame');
    document.getElementById('tab-clues')!.innerHTML = renderScored(data.others, 'Activity');

    statusEl.textContent = '';
    resultEl.hidden = false;

    await Promise.all([
      loadQuests(username, tabCtx),
      loadDiaries(username, tabCtx),
      loadCombatAchievements(username, tabCtx),
      loadCollectionLog(username, tabCtx),
    ]);
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Lookup failed');
    statusEl.classList.add('error');
  }
}

onEnterOrClick(usernameInput, searchBtn, () => void search());
window.addEventListener('osrs-session-change', () => prefillUsername(usernameInput));
