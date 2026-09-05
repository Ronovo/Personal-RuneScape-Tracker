import { fmt, escapeHtml, syncSetupStepsHtml, fmtSyncedAt } from '../format.js';
import type { DiaryProgressData, DiaryTier } from '../types.js';
import { loadSyncedTab } from './context.js';
import type { CharacterTabContext } from './context.js';

const TIER_LABELS: Record<DiaryTier, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
  ELITE: 'Elite',
};

const DIARY_SYNC_HELP_HTML = `
  <p><strong>No synced achievement diary data found for this name.</strong> Diary tier completion comes from the Leagues Tasks RuneLite plugin:</p>
  <ol>${syncSetupStepsHtml('Sync Achievement Diary')}
  </ol>
  <p>Then search for your name again here.</p>`;

export interface DiariesTabRefs {
  syncHelpEl: HTMLElement;
  resultEl: HTMLElement;
  areasEl: HTMLElement;
}

let syncHelpEl: HTMLElement;
let resultEl: HTMLElement;
let diaryAreasEl: HTMLElement;

function renderDiaries(data: DiaryProgressData): void {
  document.getElementById('diariesComplete')!.textContent = fmt(data.summary.complete);
  document.getElementById('diariesTotal')!.textContent = fmt(data.summary.total);
  document.getElementById('diariesLastSynced')!.textContent = fmtSyncedAt(data.syncedAt);

  diaryAreasEl.innerHTML = data.areas.map((area) => {
    const isKaramjaPartial = area.area === 'KARAMJA' && area.total < 4;
    const tiers = area.tiers.map((tier) => {
      const cls = tier.complete ? 'cl-pill complete' : 'cl-pill';
      return `<span class="${cls}">${TIER_LABELS[tier.tier]}</span>`;
    }).join('');
    const karamjaNote = isKaramjaPartial
      ? '<p class="status">Easy, Medium, and Hard are not available as tier-complete flags for Karamja.</p>'
      : '';
    return `
      <article class="diary-card">
        <h3>${escapeHtml(area.name)}</h3>
        <div class="diary-tiers">${tiers}</div>
        <span class="diary-count">${area.complete}/${area.total} tiers complete</span>
        ${karamjaNote}
      </article>`;
  }).join('');
}

export function initDiariesTab(refs: DiariesTabRefs): void {
  syncHelpEl = refs.syncHelpEl;
  resultEl = refs.resultEl;
  diaryAreasEl = refs.areasEl;
}

export function loadDiaries(username: string, ctx: CharacterTabContext): Promise<void> {
  return loadSyncedTab<DiaryProgressData>({
    url: `/api/diaries/${encodeURIComponent(username)}`,
    ctx,
    resultEl,
    syncHelpEl,
    syncHelpHtml: DIARY_SYNC_HELP_HTML,
    errorText: 'Failed to load achievement diaries',
    render: renderDiaries,
  });
}
