// Grand Exchange movers grid + item search.

import { fmtGp, fmtPct, fmtGpShort, pctClass, escapeHtml, fetchJson, errorMessage, el } from './format.js';
import './session.js';
import type { MoverItem, MoversResponse, SearchResult, ApiErrorBody, GeView } from './types.js';

const statusEl = el('status');
const gridEl = el('grid');
const gridTitleEl = el('gridTitle');
const searchInput = el<HTMLInputElement>('itemSearch');
const gridSizeEl = el<HTMLSelectElement>('gridSize');
const viewButtons = document.querySelectorAll<HTMLButtonElement>('#directionToggle button[data-view]');

const MOBILE_MQ = window.matchMedia('(max-width: 700px)');

const VIEW_TITLES: Record<GeView, string> = {
  risers: 'Rising (24h)',
  fallers: 'Dropping (24h)',
  penny: 'Penny Arcade',
  random: 'Random',
  spread: 'Spread',
  staircase: 'Staircase'
};

const state: { view: GeView; randomSeed: string } = {
  view: 'risers',
  randomSeed: ''
};

function newRandomSeed(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  return `${Date.now()}-${random}`;
}

// Mobile uses 6/24 instead of 5/25 so its two-column grid ends on a full row.
function gridSizeChoices(): number[] {
  return MOBILE_MQ.matches ? [6, 10, 24, 50] : [5, 10, 25, 50];
}

// Preserve the nearest equivalent choice when crossing the mobile breakpoint.
function mapGridSize(n: number): number {
  if (MOBILE_MQ.matches) {
    if (n === 5) return 6;
    if (n === 25) return 24;
    return n;
  }
  if (n === 6) return 5;
  if (n === 24) return 25;
  return n;
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
        <img src="${item.icon}" alt="" loading="lazy" />
        <span class="name">${escapeHtml(item.name)}</span>
      </a>
      <span class="price">${priceHtml}</span>
      ${pctHtml}
      ${metaBits.length ? `<span class="meta">${metaBits.join(' · ')}</span>` : ''}
      <a class="flip-link" href="flip.html?ids=${item.id}">Flip</a>
    </div>`;
}

function renderGrid(items: (MoverItem | SearchResult)[]): void {
  gridEl.innerHTML = items.length
    ? items.map(itemCell).join('')
    : '<p class="status">No items match.</p>';
}

// Builds the movers query from the filter row. Empty max-price is omitted so
// the server treats it as "no cap" rather than 0.
function filterQuery(): URLSearchParams {
  const minVolume = el<HTMLInputElement>('minVolume').value;
  const minPrice = el<HTMLInputElement>('minPrice').value;
  const maxPrice = el<HTMLInputElement>('maxPrice').value;
  const membersOnly = el<HTMLSelectElement>('membersOnly').value;
  const sort = el<HTMLSelectElement>('sortBy').value;
  const hideStale = el<HTMLInputElement>('hideStale').checked ? '1' : '0';
  const params = new URLSearchParams({
    minVolume, minPrice, membersOnly, sort, hideStale,
    limit: String(currentGridSize()), view: state.view
  });
  if (state.view === 'random') params.set('seed', state.randomSeed);
  if (maxPrice) params.set('maxPrice', maxPrice);
  return params;
}

async function loadMovers(): Promise<void> {
  gridTitleEl.textContent = VIEW_TITLES[state.view];
  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');

  try {
    const { ok, data } = await fetchJson<MoversResponse & ApiErrorBody>(`/api/ge/movers?${filterQuery()}`);
    if (!ok) throw new Error(data.error || 'Failed to load movers');

    const items = state.view === 'risers' || state.view === 'fallers'
      ? data[state.view]
      : data.items ?? [];
    renderGrid(items);
    statusEl.textContent = `${data.consideredCount} items matched your filters (prices cached ~5 min).`;
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Failed to load movers');
    statusEl.classList.add('error');
  }
}

// Name search replaces the movers grid until the box is cleared.
async function loadSearch(query: string): Promise<void> {
  gridTitleEl.textContent = `Search: "${query}"`;
  statusEl.textContent = 'Searching...';
  statusEl.classList.remove('error');

  try {
    const { ok, data: body } = await fetchJson<SearchResult[] | ApiErrorBody>(`/api/ge/search?q=${encodeURIComponent(query)}`);
    if (!ok) throw new Error((body as ApiErrorBody).error || 'Search failed');

    const results = body as SearchResult[];
    renderGrid(results.slice(0, currentGridSize()));
    statusEl.textContent = `${results.length} item(s) found.`;
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Search failed');
    statusEl.classList.add('error');
  }
}

function setView(view: GeView): void {
  // Entering or re-clicking Random gets a new seed, while reloads keep the grid stable.
  if (view === 'random' && (state.view === 'random' || !state.randomSeed)) {
    state.randomSeed = newRandomSeed();
  }
  state.view = view;
  viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === view));
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
      loadSearch(q);
    } else {
      setView('risers');
      loadMovers();
    }
  }, 300);
});

viewButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    searchInput.value = '';
    setView(btn.dataset.view as GeView);
    loadMovers();
  });
});

function reloadGrid(): void {
  if (isSearching()) {
    loadSearch(searchInput.value.trim());
  } else {
    loadMovers();
  }
}

el('refreshBtn').addEventListener('click', reloadGrid);

gridSizeEl.addEventListener('change', reloadGrid);

MOBILE_MQ.addEventListener('change', () => {
  syncGridSizeOptions();
  reloadGrid();
});

syncGridSizeOptions();
loadMovers();
