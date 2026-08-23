// Character hiscores page. Username box is pre-filled from session when set.

import { fmt, fetchJson, errorMessage, onEnterOrClick } from './format.js';
import { prefillUsername } from './session.js';
import type { HiscoresData, SkillEntry, ScoredEntry, ApiErrorBody } from './types.js';

const usernameInput = document.getElementById('username') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn')!;
const statusEl = document.getElementById('status')!;
const resultEl = document.getElementById('result') as HTMLElement;

prefillUsername(usernameInput);

function renderSkills(skills: SkillEntry[]): string {
  const rows = skills.map((s) => `
    <tr>
      <td>${s.name}</td>
      <td>${s.level}</td>
      <td>${fmt(s.xp)}</td>
      <td>${s.rank ? fmt(s.rank) : '-'}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Skill</th><th>Level</th><th>XP</th><th>Rank</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderScored(entries: ScoredEntry[], label: string): string {
  if (!entries.length) return `<p class="status">No ranked ${label} yet.</p>`;
  const rows = entries.map((e) => `
    <tr>
      <td>${e.name}</td>
      <td>${fmt(e.score)}</td>
      <td>${e.rank ? fmt(e.rank) : '-'}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>${label}</th><th>Score / KC</th><th>Rank</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Tab strip toggles .tab-panel visibility via the hidden attribute.
function activateTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>('.submenu button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${tab}`));
}

document.querySelectorAll<HTMLButtonElement>('.submenu button').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab!));
});

async function search(): Promise<void> {
  const username = usernameInput.value.trim();
  if (!username) return;

  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');
  resultEl.hidden = true;

  try {
    const { ok, data } = await fetchJson<HiscoresData & ApiErrorBody>(`/api/hiscores/${encodeURIComponent(username)}`);
    if (!ok) throw new Error(data.error || 'Lookup failed');

    document.getElementById('combatLevel')!.textContent = String(data.combatLevel);
    document.getElementById('totalLevel')!.textContent = fmt(data.totalLevel);
    document.getElementById('totalXp')!.textContent = fmt(data.totalXp);

    document.getElementById('tab-skills')!.innerHTML = renderSkills(data.skills);
    document.getElementById('tab-bosses')!.innerHTML = renderScored(data.bosses, 'Boss');
    document.getElementById('tab-minigames')!.innerHTML = renderScored(data.minigames, 'Minigame');
    document.getElementById('tab-others')!.innerHTML = renderScored(data.others, 'Activity');

    statusEl.textContent = '';
    resultEl.hidden = false;
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Lookup failed');
    statusEl.classList.add('error');
  }
}

onEnterOrClick(usernameInput, searchBtn, search);
