// Grand Exchange movers grid + item search.

import {
  fmtGp, fmtPct, fmtGpShort, pctClass, escapeHtml, fetchJson, errorMessage, el
} from './format.js';
import { createFilterRow, flipSortDir, sortDirLabel } from './filterRow.js';
import './chrome.js';
import { mountF2pToggle } from './f2pToggle.js';
import type { MoverItem, MoversResponse, SearchResult, ApiErrorBody, GeView, SortDir } from './types.js';

const statusEl = el('status');
const gridEl = el('grid');
const gridTitleEl = el('gridTitle');
const searchInput = el<HTMLInputElement>('itemSearch');
const gridSizeEl = el<HTMLSelectElement>('gridSize');
const viewButtons = document.querySelectorAll<HTMLButtonElement>('#directionToggle button[data-view]');
const membersOnlyEl = el<HTMLSelectElement>('membersOnly');
const sortByEl = el<HTMLSelectElement>('sortBy');
const sortDirBtn = el<HTMLButtonElement>('sortDirBtn');
const f2pFilterBtn = el<HTMLButtonElement>('f2pFilterBtn');
const f2p = mountF2pToggle({ button: f2pFilterBtn, select: membersOnlyEl, onChange: () => reloadGrid() });

const MOBILE_MQ = window.matchMedia('(max-width: 700px)');

const VIEW_TITLES: Record<GeView, string> = {
  risers: 'Rising (24h)',
  fallers: 'Dropping (24h)',
  volume: 'High Volume',
  random: 'Random'
};

// Random ranks by a seeded hash and search results come back scored by
// relevance, so the Sort field can't apply to either.
const SORT_DISABLED_HINT = 'Random picks its own order — switch views to sort.';
const SORT_SEARCH_HINT = 'Search results are ranked by how well they match — clear the search to sort.';

const FILTERS_KEY = 'osrs_ge_filters';

// The drawer's controls. view and sortDir are page state rather than controls,
// so they ride along on persist() instead of being fields.
type GeFilters = {
  minVolume: string;
  minPrice: string;
  maxPrice: string;
  sort: string;
  membersOnly: string;
  maxAgeMinutes: string;
  hideStale: boolean;
  gridSize: string;
};

type GeSavedState = { sortDir: SortDir; view: GeView };

// What Reset restores, and what the page opens with the first time.
const DEFAULTS: GeFilters = {
  minVolume: '500',
  minPrice: '50',
  maxPrice: '',
  sort: 'pctChange',
  membersOnly: 'all',
  maxAgeMinutes: '',
  hideStale: false,
  gridSize: '25'
};

const filters = createFilterRow<GeFilters>(FILTERS_KEY, [
  { id: 'minVolume' },
  { id: 'minPrice' },
  { id: 'maxPrice', blankable: true },
  { id: 'maxAgeMinutes', blankable: true },
  { id: 'hideStale', kind: 'checked' },
  { id: 'membersOnly' },
  { id: 'sortBy', key: 'sort' },
  { id: 'gridSize' },
], DEFAULTS);

const state: { view: GeView; randomSeed: string; sortDir: SortDir } = {
  view: 'risers',
  randomSeed: '',
  sortDir: 'desc'
};

// First direction for a sort key: everything leads with the highest value,
// except Dropping by % change, where "best first" means the biggest faller.
function defaultSortDir(sort: string, view: GeView): SortDir {
  return sort === 'pctChange' && view === 'fallers' ? 'asc' : 'desc';
}

function updateSortUi(): void {
  sortDirBtn.textContent = sortDirLabel(state.sortDir);
}

function applyFiltersToForm(values: Partial<GeFilters>, sortDir?: SortDir): void {
  filters.apply(values);
  state.sortDir = sortDir === 'asc' || sortDir === 'desc'
    ? sortDir
    : defaultSortDir(sortByEl.value, state.view);
  updateSortUi();
}

function persistFilters(): void {
  filters.persist({ sortDir: state.sortDir, view: state.view });
}

// Last-used filter row, view and grid size survive reloads, the same way the
// Flip Helper remembers its own - so coming back from a Flip link lands you on
// the view you left.
function restoreFilters(): void {
  const saved = filters.saved<GeSavedState>();
  // setViewActive, not setView: restoring a view is not the same as clicking
  // it, and setView's entering-a-view side effects would overwrite the saved
  // sort key and direction. It runs first because the direction fallback
  // depends on which view we are on.
  setViewActive(saved.view && saved.view in VIEW_TITLES ? saved.view : 'risers');
  applyFiltersToForm(saved, saved.sortDir);
}

function resetFilters(): void {
  filters.clear();
  applyFiltersToForm(DEFAULTS);
  f2p.sync();
  reloadGrid();
}

function newRandomSeed(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  return `${Date.now()}-${random}`;
}

// Desktop/mobile equivalents for each grid-size choice, in display order.
// Mobile uses 6/24 instead of 5/25 so its two-column grid ends on a full row;
// 10 and 50 already do on both layouts, so they map to themselves.
const GRID_SIZE_PAIRS: [desktop: number, mobile: number][] = [[5, 6], [10, 10], [25, 24], [50, 50]];

function gridSizeChoices(): number[] {
  return GRID_SIZE_PAIRS.map(([desktop, mobile]) => (MOBILE_MQ.matches ? mobile : desktop));
}

// Preserve the nearest equivalent choice when crossing the mobile breakpoint.
function mapGridSize(n: number): number {
  const pair = GRID_SIZE_PAIRS.find(([desktop, mobile]) => n === desktop || n === mobile);
  if (!pair) return n;
  return MOBILE_MQ.matches ? pair[1] : pair[0];
}

function currentGridSize(): number {
  const n = Number(gridSizeEl.value);
  return Number.isFinite(n) && n > 0 ? n : gridSizeChoices()[2]!;
}

function syncGridSizeOptions(): void {
  const selected = mapGridSize(currentGridSize());
  gridSizeEl.innerHTML = gridSizeChoices()
    .map((n) => `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`)
    .join('');
}

// Card is a div (not a single <a>) so the item link and Flip link can coexist.
function itemCell(item: MoverItem | SearchResult): string {
  const pct = item.pctChange;
  const pctHtml = pct === null || pct === undefined
    ? ''
    : `<span class="pct ${pctClass(pct)}">${fmtPct(pct)} <span class="pct-label">~24h change</span></span>`;
  const priceHtml = item.currentPrice ? fmtGp(item.currentPrice) : 'n/a';
  const margin = item.marginAfterTax != null ? fmtGpShort(item.marginAfterTax) : null;
  const metaBits: string[] = [];
  if (margin) metaBits.push(`${margin} after tax`);
  metaBits.push(`${item.volume24h.toLocaleString('en-US')} /day`);
  return `
    <div class="ge-cell">
      <a class="ge-cell-main" href="item.html?id=${item.id}">
        <img src="${escapeHtml(item.icon)}" alt="" loading="lazy" />
        <span class="name">${escapeHtml(item.name)}</span>
      </a>
      <span class="price">${priceHtml}</span>
      ${pctHtml}
      ${metaBits.length ? `<span class="meta">${metaBits.join(' · ')}</span>` : ''}
      <a class="flip-link" href="flip.html?ids=${item.id}&amp;from=ge">Flip</a>
    </div>`;
}

function renderGrid(items: (MoverItem | SearchResult)[]): void {
  gridEl.innerHTML = items.length
    ? items.map(itemCell).join('')
    : '<p class="status">No items match.</p>';
}

// Builds the movers query from the filter row. Empty max-price is omitted so
// the server treats it as "no cap" rather than 0. Pure: saving the row is
// loadMovers' job, not something a query builder should do on the side.
function filterQuery(): URLSearchParams {
  const minVolume = el<HTMLInputElement>('minVolume').value;
  const minPrice = el<HTMLInputElement>('minPrice').value;
  const maxPrice = el<HTMLInputElement>('maxPrice').value;
  const maxAgeMinutes = el<HTMLInputElement>('maxAgeMinutes').value;
  const membersOnly = membersOnlyEl.value;
  const sort = sortByEl.value;
  const sortDir = state.sortDir;
  const hideStale = el<HTMLInputElement>('hideStale').checked ? '1' : '0';
  const params = new URLSearchParams({
    minVolume, minPrice, membersOnly, sort, sortDir, hideStale,
    limit: String(currentGridSize()), view: state.view
  });
  if (state.view === 'random') params.set('seed', state.randomSeed);
  if (maxPrice) params.set('maxPrice', maxPrice);
  if (maxAgeMinutes) params.set('maxAgeMinutes', maxAgeMinutes);
  return params;
}

function viewTitle(view: GeView): string {
  return f2p.isF2p() ? `${VIEW_TITLES[view]} · F2P` : VIEW_TITLES[view];
}

async function loadMovers(): Promise<void> {
  persistFilters();
  gridTitleEl.textContent = viewTitle(state.view);
  syncSortAvailability();
  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');

  try {
    const { ok, data } = await fetchJson<MoversResponse & ApiErrorBody>(`/api/ge/movers?${filterQuery()}`);
    if (!ok) throw new Error(data.error || 'Failed to load movers');

    const items = (state.view === 'risers' || state.view === 'fallers'
      ? data[state.view]
      : data.items) ?? [];
    renderGrid(items);
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Failed to load movers');
    statusEl.classList.add('error');
  }
}

function matchesMembers(item: { members: boolean }): boolean {
  const filter = membersOnlyEl.value;
  if (filter === 'members') return item.members;
  if (filter === 'f2p') return !item.members;
  return true;
}

// Name search replaces the movers grid until the box is cleared.
async function loadSearch(query: string): Promise<void> {
  gridTitleEl.textContent = f2p.isF2p() ? `Search: "${query}" · F2P` : `Search: "${query}"`;
  syncSortAvailability();
  statusEl.textContent = 'Searching...';
  statusEl.classList.remove('error');

  try {
    const { ok, data: body } = await fetchJson<SearchResult[] | ApiErrorBody>(`/api/ge/search?q=${encodeURIComponent(query)}`);
    if (!ok) throw new Error((body as ApiErrorBody).error || 'Search failed');

    const results = (body as SearchResult[]).filter(matchesMembers);
    renderGrid(results.slice(0, currentGridSize()));
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Search failed');
    statusEl.classList.add('error');
  }
}

// Makes a view current without any of the "you just clicked this" behaviour, so
// restoring saved state and clicking a tab can share the bookkeeping.
function setViewActive(view: GeView): void {
  if (view === 'random' && !state.randomSeed) state.randomSeed = newRandomSeed();
  state.view = view;
  updateSortUi();
  viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  syncSortAvailability();
}

function setView(view: GeView): void {
  // Re-clicking Random rerolls; plain reloads keep the grid stable.
  if (view === 'random' && state.view === 'random') state.randomSeed = newRandomSeed();
  // High Volume is just the filter row sorted by volume, so point Sort at it on arrival.
  if (view === 'volume' && state.view !== 'volume') sortByEl.value = 'volume';
  if (view !== state.view) state.sortDir = defaultSortDir(sortByEl.value, view);
  setViewActive(view);
}

// Every view but Random honours the Sort select; disable it there rather than
// letting it look live and do nothing.
function syncSortAvailability(): void {
  const searching = isSearching();
  const inert = searching || state.view === 'random';
  const hint = searching ? SORT_SEARCH_HINT : SORT_DISABLED_HINT;
  sortByEl.disabled = inert;
  sortDirBtn.disabled = inert;
  sortByEl.title = inert ? hint : '';
  sortDirBtn.title = inert ? hint : 'Toggle sort direction';
}

function isSearching(): boolean {
  return searchInput.value.trim().length > 0;
}

function isSpecialView(view: GeView): boolean {
  return view !== 'risers' && view !== 'fallers';
}

let searchTimer: ReturnType<typeof setTimeout>;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  // Debounce so we don't fire a search on every keystroke.
  searchTimer = setTimeout(() => {
    if (q) {
      if (isSpecialView(state.view)) setView('risers');
      void loadSearch(q);
    } else {
      setView('risers');
      void loadMovers();
    }
  }, 300);
});

viewButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    searchInput.value = '';
    setView(btn.dataset.view as GeView);
    void loadMovers();
  });
});

function reloadGrid(): void {
  if (isSearching()) {
    void loadSearch(searchInput.value.trim());
  } else {
    void loadMovers();
  }
}

el('refreshBtn').addEventListener('click', reloadGrid);
el('resetBtn').addEventListener('click', resetFilters);

// Picking a new sort key resets to that key's natural direction; the button
// flips it. Mirrors applySort() on the Flip Helper.
sortByEl.addEventListener('change', () => {
  state.sortDir = defaultSortDir(sortByEl.value, state.view);
  updateSortUi();
  reloadGrid();
});

sortDirBtn.addEventListener('click', () => {
  state.sortDir = flipSortDir(state.sortDir);
  updateSortUi();
  reloadGrid();
});

gridSizeEl.addEventListener('change', reloadGrid);

MOBILE_MQ.addEventListener('change', () => {
  syncGridSizeOptions();
  reloadGrid();
});

restoreFilters();
syncGridSizeOptions();
void loadMovers();
