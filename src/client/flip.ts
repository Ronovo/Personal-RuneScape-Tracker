// Flip Helper: ranked GE scanner, presets, watchlist, and a client-side calculator.

import {
  fmtGp, fmtPct, escapeHtml, geTax, fetchJson, errorMessage, safeJsonParse, el,
  storageGet, storageRemove, storageSet
} from './format.js';
import { createFilterRow, flipSortDir, sortDirLabel } from './filterRow.js';
import { getWatchlist, loadWatchlist, toggleWatchlist, getBankroll, setBankroll } from './identity.js';
import './chrome.js';
import { FLIP_SORTS } from './types.js';
import type { FlipItem, FlipsResponse, ApiErrorBody, FlipSort, SortDir, MembersFilter } from './types.js';
import { mountF2pToggle } from './f2pToggle.js';
import { DEFAULTS, PRESETS, PRESET_NOTES } from './flipPresets.js';
import type { PresetName, FilterValues } from './flipPresets.js';
import {
  ALL_COLUMN_KEYS, FACTORY_DEFAULT_COLUMNS, cardCellsHtml, columnCellsHtml,
  columnHeadersHtml, columnsPanelHtml, confidenceDotHtml, sortOptionsHtml,
  visibleColumnCount
} from './flipColumns.js';
import type { ColumnKey } from './flipColumns.js';

const statusEl = document.getElementById('status')!;
const bodyEl = document.getElementById('flipBody')!;
const cardsEl = document.getElementById('flipCards')!;
const presetToolbar = document.getElementById('presetToolbar')!;
const resultsTitleEl = document.getElementById('resultsTitle')!;
const FILTERS_KEY = 'osrs_flip_filters';

// The drawer's controls. sort/sortDir are page state and ride along on
// persist(); everything a preset writes is a field here.
const filterRow = createFilterRow<Record<string, string>>(FILTERS_KEY, [
  { id: 'minVolume' },
  { id: 'minPrice' },
  { id: 'maxPrice', blankable: true },
  { id: 'minMargin' },
  { id: 'minRoi' },
  { id: 'minMarginVsAvg', blankable: true },
  { id: 'maxAgeMinutes', blankable: true },
  { id: 'membersOnly' },
  { id: 'pageSize' },
], {
  minVolume: String(DEFAULTS.minVolume ?? ''),
  minPrice: String(DEFAULTS.minPrice ?? ''),
  maxPrice: '',
  minMargin: String(DEFAULTS.minMargin ?? ''),
  minRoi: String(DEFAULTS.minRoi ?? ''),
  minMarginVsAvg: '',
  maxAgeMinutes: '',
  membersOnly: DEFAULTS.membersOnly ?? 'all',
  pageSize: String(DEFAULTS.pageSize ?? 50),
});

// Toggleable table columns (Item and the action buttons are always shown;
// Realistic is controlled separately by whether a bankroll is set). The key
// list, labels, tooltips and cell formatting all come from flipColumns.ts.
// A user can overwrite "the default" via Set as Default (saved to
// DEFAULT_COLUMNS_KEY) and restore FACTORY_DEFAULT_COLUMNS via Reset to
// Factory Default. Toggles are session-only unless saved via Set as Default.
const DEFAULT_COLUMNS_KEY = 'osrs_flip_default_columns';

// The checkbox panel and sort dropdown are generated once; the header row is
// rebuilt whenever the visible column set changes (see renderColumns).
el('columnsPanel').querySelector('.columns-panel-actions')!.insertAdjacentHTML('beforebegin', columnsPanelHtml());
el('flipSort').insertAdjacentHTML('beforeend', sortOptionsHtml());

const headRowEl = document.querySelector('#flipTable thead tr')!;
// The two fixed columns (actions, Item) that every render keeps.
const FIXED_COLUMNS = headRowEl.querySelectorAll('th').length;

interface ResultViewSnapshot {
  page: number;
  filters: FilterValues;
  bankroll: string;
  search: string;
  preset: PresetName | null;
  idsFromUrl: number[] | null;
}

interface CalculatorSelection extends ResultViewSnapshot {
  id: number;
}

// First-click direction per key: numeric columns lead with "best/highest
// first" (matches the table's original single-direction behavior); the name
// column leads with A-Z since that's what "alphabetical" means to most people.
function defaultSortDir(key: FlipSort): SortDir {
  return key === 'name' ? 'asc' : 'desc';
}

// idsFromUrl is set by GE "Flip" deep-links (?ids=4151) and bypasses filters.
// page/totalPages track the current results page; reset to page 1 whenever
// the underlying result set could change (new filters, sort, preset, page size).
const state: {
  sort: FlipSort;
  sortDir: SortDir;
  preset: PresetName | null;
  idsFromUrl: number[] | null;
  page: number;
  totalPages: number;
} = {
  sort: DEFAULTS.sort ?? 'profitPerLimit',
  sortDir: DEFAULTS.sortDir ?? 'desc',
  preset: null,
  idsFromUrl: null,
  page: 1,
  totalPages: 1
};

let calculatorSelection: CalculatorSelection | null = null;
let calcTaxExempt = false;
let activeResultView: ResultViewSnapshot | null = null;
let pendingCalculatorItemId: number | null = null;

// Starting column set for a fresh page load: the user's saved default if
// they've set one via "Set as Default", otherwise FACTORY_DEFAULT_COLUMNS.
// Checkbox toggles during the session are scratch-only (see the columnsPanel
// change listener below) - only Set as Default writes to DEFAULT_COLUMNS_KEY.
function loadVisibleColumns(): Set<ColumnKey> {
  const parsed = safeJsonParse<string[]>(storageGet(localStorage, DEFAULT_COLUMNS_KEY), []);
  const valid = parsed.filter((k): k is ColumnKey => (ALL_COLUMN_KEYS as string[]).includes(k));
  return valid.length ? new Set(valid) : new Set(FACTORY_DEFAULT_COLUMNS);
}

let visibleColumns = loadVisibleColumns();

// Realistic Profit is only ever meaningful with a bankroll set, so it's
// gated by both the checkbox AND this flag (set from renderRows each render).
// Tracked here rather than re-checked only at render time so toggling the
// checkbox itself (no re-render involved) still respects it.
let bankrollOnForColumns = false;

// The last rendered page, so toggling a column re-renders from memory instead
// of re-running the scan.
let lastItems: FlipItem[] | null = null;

// Realistic Profit only means anything with a bankroll set, so it is gated by
// both the checkbox and that flag rather than by the checkbox alone.
function isColumnVisible(key: ColumnKey): boolean {
  if (!visibleColumns.has(key)) return false;
  return key !== 'realisticProfit' || bankrollOnForColumns;
}

// Rebuilds the header and, if rows are on screen, re-renders them for the new
// column set. Hidden columns are left out of the markup entirely, so this is a
// render rather than a visibility toggle - still no re-fetch, since the last
// payload is kept in lastItems.
function renderColumns(): void {
  headRowEl.querySelectorAll('th[data-col]').forEach((th) => th.remove());
  headRowEl.insertAdjacentHTML('beforeend', columnHeadersHtml(isColumnVisible));
  updateSortUi();
  document.querySelectorAll<HTMLInputElement>('#columnsPanel input[type="checkbox"]').forEach((cb) => {
    cb.checked = visibleColumns.has(cb.dataset.col as ColumnKey);
  });
  if (lastItems) renderRows(lastItems, bankrollOnForColumns);
}

// The drawer as a plain object. Both the query builder and the calculator's
// "return to this result view" snapshot want it, so it stays a function rather
// than folding into buildQuery().
function readFiltersFromForm(): FilterValues {
  return {
    ...filterRow.read(),
    membersOnly: el<HTMLSelectElement>('membersOnly').value as MembersFilter,
    sort: state.sort,
    sortDir: state.sortDir
  };
}

function applyFiltersToForm(filters: FilterValues, bankroll?: number | string | null): void {
  filterRow.apply(filters as Partial<Record<string, string>>);
  if (bankroll) el<HTMLInputElement>('bankroll').value = String(bankroll);
  if (filters.sort) state.sort = filters.sort;
  state.sortDir = filters.sortDir ?? defaultSortDir(state.sort);
  syncSortSelect();
  updateSortUi();
}

function syncSortSelect(): void {
  const sel = document.getElementById('flipSort') as HTMLSelectElement | null;
  if (sel) sel.value = state.sort;
}

// Arrow indicator on the active table header + the direction button's label.
function updateSortUi(): void {
  document.querySelectorAll<HTMLElement>('#flipTable th[data-sort]').forEach((th) => {
    const active = th.dataset.sort === state.sort;
    th.classList.toggle('sort-active', active);
    th.classList.toggle('sort-asc', active && state.sortDir === 'asc');
    th.classList.toggle('sort-desc', active && state.sortDir === 'desc');
  });
  const dirBtn = document.getElementById('sortDirBtn');
  if (dirBtn) dirBtn.textContent = sortDirLabel(state.sortDir);
}

// Shared by header clicks and the mobile Sort dropdown: re-picking the
// current key flips direction, picking a new one resets to its default.
function applySort(key: FlipSort): void {
  if (state.sort === key) {
    state.sortDir = flipSortDir(state.sortDir);
  } else {
    state.sort = key;
    state.sortDir = defaultSortDir(key);
  }
  syncSortSelect();
  updateSortUi();
  state.page = 1;
  void load();
}

// Last-used filter row + bankroll survive reloads. Bankroll is per-user via session.ts.
function persistFilters(): void {
  filterRow.persist({ sort: state.sort, sortDir: state.sortDir });
  const bankroll = Number(el<HTMLInputElement>('bankroll').value);
  if (Number.isFinite(bankroll)) setBankroll(bankroll);
}

function restoreFilters(): void {
  const saved: FilterValues = { ...DEFAULTS, ...filterRow.saved<FilterValues>() };
  if (saved.sort && !FLIP_SORTS.includes(saved.sort)) {
    saved.sort = DEFAULTS.sort;
  }
  applyFiltersToForm(saved, getBankroll());
}

// Names the current scan above the results, mirroring GE's #gridTitle. Reads
// the active preset button's own label rather than duplicating the names, and
// tags it with the one word that says what the method optimises for.
function renderResultsTitle(): void {
  const btn = state.preset ? presetToolbar.querySelector(`[data-preset="${state.preset}"]`) : null;
  const name = btn?.textContent?.trim() || 'All flips';
  const note: string[] = [];
  if (state.preset) note.push(PRESET_NOTES[state.preset]);
  if (f2p.isF2p()) note.push('F2P');
  resultsTitleEl.innerHTML = escapeHtml(name)
    + (note.length ? ` <span class="results-note">${escapeHtml(note.join(' · '))}</span>` : '');
}

function presetButtons(): NodeListOf<HTMLButtonElement> {
  return presetToolbar.querySelectorAll<HTMLButtonElement>('button[data-preset]');
}

function setPresetActive(name: PresetName | null): void {
  state.preset = name && name in PRESETS ? name : null;
  presetButtons().forEach((b) => b.classList.toggle('active', b.dataset.preset === state.preset));
}

// Presets just write the filter inputs (resetting to DEFAULTS first) and reload.
// Members is carried across rather than reset: F2P is who you are playing as,
// not part of the scan method, so picking a preset must not silently clear it.
function applyPreset(name: PresetName): void {
  const preset = PRESETS[name];
  if (!preset) return;
  const membersOnly = preset.membersOnly ?? (el<HTMLSelectElement>('membersOnly').value as MembersFilter);
  applyFiltersToForm({ ...DEFAULTS, ...preset, membersOnly }, el<HTMLInputElement>('bankroll').value || getBankroll());
  f2p.sync();
  setPresetActive(name);
  persistFilters();
  state.page = 1;
  void load();
}

// Watchlist / ?ids= go through the ids= bypass so pinned rows aren't filtered out.
function buildQuery(): URLSearchParams | null {
  const f = readFiltersFromForm();
  const params = new URLSearchParams();
  const bankroll = Number(el<HTMLInputElement>('bankroll').value);
  if (bankroll > 0) params.set('bankroll', String(bankroll));
  params.set('sort', state.sort);
  params.set('sortDir', state.sortDir);
  params.set('pageSize', String(f.pageSize || 50));
  params.set('page', String(state.page));

  const urlIds = state.idsFromUrl;
  const watch = state.preset === 'watchlist';
  if (urlIds?.length) {
    params.set('ids', urlIds.join(','));
    return params;
  }
  if (watch) {
    const ids = getWatchlist();
    if (!ids.length) return null;
    params.set('ids', ids.join(','));
    return params;
  }

  params.set('minVolume', String(f.minVolume || 0));
  params.set('minPrice', String(f.minPrice || 0));
  if (f.maxPrice !== '') params.set('maxPrice', String(f.maxPrice));
  params.set('minMargin', String(f.minMargin || 0));
  params.set('minRoi', String(f.minRoi || 0));
  if (f.minMarginVsAvg !== '') params.set('minMarginVsAvg', String(f.minMarginVsAvg));
  if (f.maxAgeMinutes !== '') params.set('maxAgeMinutes', String(f.maxAgeMinutes));
  params.set('membersOnly', f.membersOnly || 'all');
  if (state.preset === 'bankroll' && bankroll > 0) params.set('maxCapital', String(bankroll));
  const search = el<HTMLInputElement>('flipSearch').value.trim();
  if (search) params.set('name', search);
  return params;
}

function watchedSet(): Set<number> {
  return new Set(getWatchlist());
}

function renderEmpty(message: string): void {
  const colCount = FIXED_COLUMNS + visibleColumnCount(isColumnVisible);
  bodyEl.innerHTML = `<tr><td colspan="${colCount}">${message}</td></tr>`;
  cardsEl.innerHTML = `<p class="status">${message}</p>`;
}

function renderPagination(page: number, totalPages: number): void {
  state.page = page;
  state.totalPages = totalPages;
  el('pageIndicator').textContent = `Page ${page} of ${totalPages}`;
  el<HTMLButtonElement>('pagePrev').disabled = page <= 1;
  el<HTMLButtonElement>('pageNext').disabled = page >= totalPages;
}

function flipItemActions(item: FlipItem, watched: Set<number>): { buttons: string; link: string; conf: string } {
  const on = watched.has(item.id);
  return {
    buttons: `<button type="button" class="star-btn ${on ? 'on' : ''}" data-id="${item.id}" title="Watchlist">★</button>
        <button type="button" class="calc-btn" data-id="${item.id}" data-name="${escapeHtml(item.name)}" data-buy="${item.buy}" data-sell="${item.sell}" data-tax-exempt="${item.taxExempt}" title="Use in calculator">🧮</button>`,
    link: `<a class="item-link" href="item.html?id=${item.id}">
          <img src="${escapeHtml(item.icon)}" alt="" />
          ${escapeHtml(item.name)}
        </a>`,
    conf: confidenceDotHtml(item)
  };
}

function renderCard(item: FlipItem, watched: Set<number>, ctx: { bankrollOn: boolean }): string {
  const { buttons, link, conf } = flipItemActions(item, watched);
  return `
    <article class="flip-card" data-item-id="${item.id}">
      <div class="flip-card-head">
        ${buttons}
        ${link}
        ${conf}
      </div>
      <dl class="flip-card-grid">
        ${cardCellsHtml(item, ctx)}
      </dl>
    </article>`;
}

function renderRows(items: FlipItem[], bankrollOn: boolean): void {
  const watched = watchedSet();
  bankrollOnForColumns = bankrollOn;
  lastItems = items;
  if (!items.length) {
    renderEmpty('No items match.');
    return;
  }
  const ctx = { bankrollOn };
  bodyEl.innerHTML = items.map((item) => {
    const { buttons, link } = flipItemActions(item, watched);
    return `<tr data-item-id="${item.id}">
      <td>
        ${buttons}
      </td>
      <td>
        ${link}
      </td>
      ${columnCellsHtml(item, ctx, isColumnVisible)}
    </tr>`;
  }).join('');
  cardsEl.innerHTML = items.map((item) => renderCard(item, watched, ctx)).join('');
}

async function load(): Promise<boolean> {
  persistFilters();
  // Set before the empty-watchlist bail-out, so the heading never describes a
  // scan that is no longer on screen.
  renderResultsTitle();
  const params = buildQuery();
  if (!params) {
    lastItems = null;
    renderEmpty('Watchlist is empty — star items to pin them here.');
    renderPagination(1, 1);
    statusEl.textContent = '';
    activeResultView = null;
    return false;
  }

  // Capture the controls that produced this request now: Scan-gated fields can
  // be edited again while the request is in flight without changing its results.
  const requestedView: ResultViewSnapshot = {
    page: state.page,
    filters: { ...readFiltersFromForm() },
    bankroll: el<HTMLInputElement>('bankroll').value,
    search: el<HTMLInputElement>('flipSearch').value,
    preset: state.preset,
    idsFromUrl: state.idsFromUrl ? [...state.idsFromUrl] : null
  };
  // No "Scanning..." label: the request is short enough that it only flickers.
  // #status is now purely an error slot.
  statusEl.textContent = '';
  statusEl.classList.remove('error');
  try {
    const { ok, data } = await fetchJson<FlipsResponse & ApiErrorBody>(`/api/ge/flips?${params}`);
    if (!ok) throw new Error(data.error || 'Scan failed');
    const bankrollOn = Number(el<HTMLInputElement>('bankroll').value) > 0;
    const items = data.items || [];
    renderRows(items, bankrollOn);
    renderPagination(data.page, data.totalPages);
    activeResultView = { ...requestedView, page: data.page };

    // A single-item GE Flip link behaves like clicking that row's calculator button.
    if (pendingCalculatorItemId !== null) {
      const item = items.find((candidate) => candidate.id === pendingCalculatorItemId);
      pendingCalculatorItemId = null;
      if (item) loadIntoCalculator(item.id, item.name, item.buy, item.sell, item.taxExempt);
    }
    return true;
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Scan failed');
    statusEl.classList.add('error');
    return false;
  }
}

// Pure client-side; uses geTax so the numbers agree with the table.
// calcTaxExempt carries the exemption flag from the item the calculator was
// opened with, and stays in effect while its buy/sell fields are edited by
// hand — exemption is a property of the item, not of the current price.
function updateCalc(): void {
  const buy = Number(el<HTMLInputElement>('calcBuy').value);
  const sell = Number(el<HTMLInputElement>('calcSell').value);
  const qty = Math.max(1, Number(el<HTMLInputElement>('calcQty').value) || 1);
  if (!buy || !sell) {
    el('calcTax').textContent = 'n/a';
    el('calcProfit').textContent = 'n/a';
    el('calcRoi').textContent = 'n/a';
    el('calcCapital').textContent = 'n/a';
    return;
  }
  const taxEach = geTax(sell, calcTaxExempt);
  const profitEach = sell - buy - taxEach;
  el('calcTax').textContent = fmtGp(taxEach * qty);
  el('calcProfit').textContent = fmtGp(profitEach * qty);
  el('calcRoi').textContent = fmtPct(buy ? (profitEach / buy) * 100 : null);
  el('calcCapital').textContent = fmtGp(buy * qty);
}

// "Use in calculator" copies an item's buy/sell into the calc fields and
// scrolls the calculator into view. Qty is left as-is — clobbering a
// quantity the user is mid-typing would be more surprising than useful.
function loadIntoCalculator(id: number, name: string, buy: number, sell: number, taxExempt: boolean): void {
  calcTaxExempt = taxExempt;
  calculatorSelection = activeResultView
    ? {
        ...activeResultView,
        id,
        filters: { ...activeResultView.filters },
        idsFromUrl: activeResultView.idsFromUrl ? [...activeResultView.idsFromUrl] : null
      }
    : null;
  el<HTMLInputElement>('calcBuy').value = String(buy);
  el<HTMLInputElement>('calcSell').value = String(sell);
  el('calcSelectedLabel').textContent = name ? ` — ${name}` : '';
  el<HTMLButtonElement>('returnToItemBtn').hidden = !calculatorSelection;
  updateCalc();
  el('calcHeading').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Restore the result view captured with the calculator selection before
// scrolling, so pagination or later filter changes cannot strand the item.
async function returnToCalculatorItem(): Promise<void> {
  const selection = calculatorSelection;
  if (!selection) return;

  clearTimeout(searchTimer);
  applyFiltersToForm(selection.filters);
  el<HTMLInputElement>('bankroll').value = selection.bankroll;
  el<HTMLInputElement>('flipSearch').value = selection.search;
  setPresetActive(selection.preset);
  state.idsFromUrl = selection.idsFromUrl ? [...selection.idsFromUrl] : null;
  state.page = selection.page;

  const returnBtn = el<HTMLButtonElement>('returnToItemBtn');
  returnBtn.disabled = true;
  const loaded = await load();
  returnBtn.disabled = false;
  if (!loaded) return;

  const itemContainer = window.matchMedia('(max-width: 700px)').matches ? cardsEl : bodyEl;
  const target = itemContainer.querySelector<HTMLElement>(`[data-item-id="${selection.id}"]`);
  if (!target) {
    statusEl.textContent = 'The selected item is no longer available in its original result view.';
    statusEl.classList.add('error');
    return;
  }

  target.classList.remove('return-target');
  // Force layout so returning to the same row restarts its CSS animation.
  void target.offsetWidth;
  target.classList.add('return-target');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => target.classList.remove('return-target'), 2100);
}

presetButtons().forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset as PresetName));
});

// Scan clears a GE deep-link so the current filter row is used, but keeps
// watchlist / bankroll presets active.
function rescan(): void {
  pendingCalculatorItemId = null;
  state.idsFromUrl = null;
  if (state.preset !== 'watchlist' && state.preset !== 'bankroll') {
    setPresetActive(null);
  }
  state.page = 1;
  void load();
}

el('scanBtn').addEventListener('click', rescan);

// Reset drops the filter row and the active preset back to the built-in
// defaults. Bankroll is deliberately left alone - it is per-user session data,
// not a filter, and DEFAULTS carries no value for it.
el('resetBtn').addEventListener('click', () => {
  filterRow.clear();
  applyFiltersToForm(DEFAULTS);
  f2p.sync();
  setPresetActive(null);
  rescan();
});

// F2P narrows the current results rather than starting a new scan, so unlike
// rescan() it keeps the active preset highlighted. load() persists the filters.
const f2p = mountF2pToggle({
  button: el<HTMLButtonElement>('f2pFilterBtn'),
  select: el<HTMLSelectElement>('membersOnly'),
  onChange: () => { state.page = 1; void load(); }
});
el('returnToItemBtn').addEventListener('click', () => void returnToCalculatorItem());

// Item name search - live, debounced, unlike every other filter (which only
// applies on Scan click). Reuses the same rescan() path so it interacts with
// presets/deep-links the same way clicking Scan would.
let searchTimer: ReturnType<typeof setTimeout>;
el<HTMLInputElement>('flipSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(rescan, 300);
});

// Header click re-requests with that sort so ranking is over the whole set,
// not the page. Clicking the already-active column flips its direction.
// Delegated to the row, since renderColumns() rebuilds the cells beneath it.
headRowEl.addEventListener('click', (ev) => {
  const th = (ev.target as HTMLElement).closest<HTMLTableCellElement>('th[data-sort]');
  if (th?.dataset.sort) applySort(th.dataset.sort as FlipSort);
});

el<HTMLSelectElement>('flipSort').addEventListener('change', () => {
  applySort(el<HTMLSelectElement>('flipSort').value as FlipSort);
});

// Explicit direction flip for whatever's currently sorted - the only way to
// reverse direction on mobile, where the table (and its clickable headers) is hidden.
el('sortDirBtn').addEventListener('click', () => {
  state.sortDir = flipSortDir(state.sortDir);
  updateSortUi();
  state.page = 1;
  void load();
});

// Per-page select and Prev/Next paging. Prev/Next are disabled at the bounds
// by renderPagination(), but guard here too in case a stale click slips through.
el<HTMLSelectElement>('pageSize').addEventListener('change', () => {
  state.page = 1;
  void load();
});

el<HTMLButtonElement>('pagePrev').addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page -= 1;
  void load();
});

el<HTMLButtonElement>('pageNext').addEventListener('click', () => {
  if (state.page >= state.totalPages) return;
  state.page += 1;
  void load();
});

// Add/Remove Columns: a plain show/hide toggle for the checkbox panel.
el('columnsBtn').addEventListener('click', () => {
  const panel = el('columnsPanel');
  panel.hidden = !panel.hidden;
});

// Checking/unchecking a column just hides/shows already-rendered cells -
// no re-fetch, no page reset. This is scratch state for the current page
// load only; nothing is saved unless Set as Default is used below, so a
// refresh always lands back on whichever default is currently active.
el('columnsPanel').addEventListener('change', (ev) => {
  const cb = ev.target as HTMLInputElement;
  if (cb.type !== 'checkbox') return;
  const key = cb.dataset.col as ColumnKey;
  if (cb.checked) visibleColumns.add(key);
  else visibleColumns.delete(key);
  renderColumns();
});

// Set as Default: click once to arm it, click again within 5s to confirm -
// mirrors a "are you sure?" prompt without a native dialog. Any other trigger
// (timeout or Reset) cancels the armed state via cancelSetDefaultArmed().
let setDefaultArmTimer: number | null = null;

function cancelSetDefaultArmed(): void {
  if (setDefaultArmTimer !== null) {
    clearTimeout(setDefaultArmTimer);
    setDefaultArmTimer = null;
  }
  el('setDefaultBtn').textContent = 'Set as Default';
}

function showColumnsStatus(message: string): void {
  el('columnsDefaultStatus').textContent = message;
  setTimeout(() => {
    if (el('columnsDefaultStatus').textContent === message) el('columnsDefaultStatus').textContent = '';
  }, 3000);
}

el('setDefaultBtn').addEventListener('click', () => {
  if (setDefaultArmTimer === null) {
    el('setDefaultBtn').textContent = 'Click again to confirm';
    showColumnsStatus(`Save these ${visibleColumns.size} column(s) as your default?`);
    setDefaultArmTimer = window.setTimeout(cancelSetDefaultArmed, 5000);
    return;
  }
  clearTimeout(setDefaultArmTimer);
  setDefaultArmTimer = null;
  storageSet(localStorage, DEFAULT_COLUMNS_KEY, JSON.stringify([...visibleColumns]));
  el('setDefaultBtn').textContent = 'Set as Default';
  showColumnsStatus('Saved - this column set now loads by default.');
});

el('resetDefaultBtn').addEventListener('click', () => {
  cancelSetDefaultArmed();
  storageRemove(localStorage, DEFAULT_COLUMNS_KEY);
  visibleColumns = new Set(FACTORY_DEFAULT_COLUMNS);
  renderColumns();
  showColumnsStatus('Reset to the factory default columns.');
});

// Star toggles the per-user watchlist on table and cards. Watchlist preset
// reloads so unstars drop out of the list. Calc button loads that item's
// buy/sell into the Flip calculator below.
document.getElementById('flipResults')!.addEventListener('click', (ev) => {
  const target = ev.target as HTMLElement;
  const starBtn = target.closest<HTMLButtonElement>('.star-btn');
  if (starBtn) {
    const id = Number(starBtn.dataset.id);
    toggleWatchlist(id);
    const on = getWatchlist().includes(id);
    document.querySelectorAll<HTMLButtonElement>(`.star-btn[data-id="${id}"]`).forEach((b) => b.classList.toggle('on', on));
    if (state.preset === 'watchlist') void load();
    return;
  }
  const calcBtn = target.closest<HTMLButtonElement>('.calc-btn');
  if (!calcBtn) return;
  loadIntoCalculator(
    Number(calcBtn.dataset.id),
    calcBtn.dataset.name ?? '',
    Number(calcBtn.dataset.buy),
    Number(calcBtn.dataset.sell),
    calcBtn.dataset.taxExempt === 'true'
  );
});

['calcBuy', 'calcSell', 'calcQty'].forEach((id) => {
  el(id).addEventListener('input', updateCalc);
});

// GE Flip links land here as ?ids= so the scanner shows that item live.
const urlParams = new URLSearchParams(location.search);
const urlIds = urlParams.get('ids');
if (urlIds) {
  const ids = urlIds.split(',').map(Number).filter(Number.isInteger);
  state.idsFromUrl = ids;
  pendingCalculatorItemId = ids.length === 1 ? ids[0]! : null;
}

// GE stamps &from=ge on its Flip links. "Return to item" only restores the Flip
// result view the calculator row came from - which is a single row when you
// arrived this way - so offer a real way back instead. GE persists its own
// filters, so the link lands on the view that was left behind.
if (urlParams.get('from') === 'ge') {
  el('backToGe').hidden = false;
}

// Switching "Playing as" swaps the watchlist and bankroll buckets.
window.addEventListener('osrs-session-change', () => {
  el<HTMLInputElement>('bankroll').value = String(getBankroll() || '');
  state.page = 1;
  void loadWatchlist().then(load);
});

restoreFilters();
f2p.sync();
renderColumns();
void loadWatchlist().then(load);
updateCalc();
