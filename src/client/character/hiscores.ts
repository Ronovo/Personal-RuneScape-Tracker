import { fmt, escapeHtml } from '../format.js';
import type { SkillEntry, ScoredEntry } from '../types.js';

export function renderSkills(skills: SkillEntry[]): string {
  const rows = skills.map((s) => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.level}</td>
      <td>${fmt(s.xp)}</td>
      <td>${s.rank ? fmt(s.rank) : '-'}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Skill</th><th>Level</th><th>XP</th><th>Rank</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderScored(entries: ScoredEntry[], label: string): string {
  if (!entries.length) return `<p class="status">No ranked ${label} yet.</p>`;
  const rows = entries.map((e) => `
    <tr>
      <td>${escapeHtml(e.name)}</td>
      <td>${fmt(e.score)}</td>
      <td>${e.rank ? fmt(e.rank) : '-'}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>${label}</th><th>Score / KC</th><th>Rank</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
