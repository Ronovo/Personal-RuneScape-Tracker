import { errorMessage, fetchJson } from '../format.js';
import type { ApiErrorBody } from '../../shared/api.js';

export type CharacterTabContext = {
  statusEl: HTMLElement;
  /** False once a newer search has started, so this one's late response is dropped. */
  isCurrent: () => boolean;
};

export interface SyncedTabOptions<T> {
  url: string;
  ctx: CharacterTabContext;
  /** Hidden while loading, shown when the fetch succeeds. */
  resultEl: HTMLElement;
  /** Shown instead, carrying `syncHelpHtml`, when the player has never synced. */
  syncHelpEl: HTMLElement;
  syncHelpHtml: string;
  /** Used for both the thrown-error message and the status line fallback. */
  errorText: string;
  render: (data: T) => void;
}

/** The pill class for a count of done out of total: 'complete', 'started' or nothing. */
export function progressClass(done: number, total: number): string {
  if (total > 0 && done >= total) return 'complete';
  return done > 0 ? 'started' : '';
}

/** A progress pill's whole class list. */
export function pillClass(done: number, total: number): string {
  const progress = progressClass(done, total);
  return progress ? `cl-pill ${progress}` : 'cl-pill';
}

/**
 * Every Character tab that reads plugin-synced data loads the same way: hide
 * both panels, fetch, treat 404 as "nothing synced yet" and show the setup
 * steps, render on success, and put anything else on the page's status line.
 */
export async function loadSyncedTab<T>({
  url, ctx, resultEl, syncHelpEl, syncHelpHtml, errorText, render,
}: SyncedTabOptions<T>): Promise<void> {
  syncHelpEl.hidden = true;
  resultEl.hidden = true;

  try {
    const { ok, status, data } = await fetchJson<T & ApiErrorBody>(url);
    if (!ctx.isCurrent()) return;

    if (status === 404) {
      syncHelpEl.innerHTML = syncHelpHtml;
      syncHelpEl.hidden = false;
      return;
    }
    if (!ok) throw new Error(data.error || errorText);

    render(data);
    resultEl.hidden = false;
  } catch (err) {
    if (!ctx.isCurrent()) return;
    ctx.statusEl.textContent = errorMessage(err, errorText);
    ctx.statusEl.classList.add('error');
  }
}
