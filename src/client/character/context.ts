import { errorMessage, fetchJson } from '../format.js';
import type { ApiErrorBody } from '../types.js';

export type CharacterTabContext = {
  statusEl: HTMLElement;
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

/**
 * Every Character tab that reads plugin-synced data loads the same way: hide
 * both panels, fetch, treat 404 as "nothing synced yet" and show the setup
 * steps, render on success, and put anything else on the page's status line.
 * Quests, Diaries, Combat Achievements and Collection Log each carried their
 * own copy of this; the only real differences are the URL, the help text and
 * what render() does with the payload.
 */
export async function loadSyncedTab<T>({
  url, ctx, resultEl, syncHelpEl, syncHelpHtml, errorText, render,
}: SyncedTabOptions<T>): Promise<void> {
  syncHelpEl.hidden = true;
  resultEl.hidden = true;

  try {
    const { ok, status, data } = await fetchJson<T & ApiErrorBody>(url);

    if (status === 404) {
      syncHelpEl.innerHTML = syncHelpHtml;
      syncHelpEl.hidden = false;
      return;
    }
    if (!ok) throw new Error(data.error || errorText);

    render(data);
    resultEl.hidden = false;
  } catch (err) {
    ctx.statusEl.textContent = errorMessage(err, errorText);
    ctx.statusEl.classList.add('error');
  }
}
