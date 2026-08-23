// Flip Helper: ranked GE scanner, presets, watchlist, and a client-side calculator.
import { fmt, fmtGp, fmtGpShort, fmtPct, fmtAgo, pctClass, escapeHtml, geTax, fetchJson, errorMessage, safeJsonParse, el } from './format.js';
import { getWatchlist, toggleWatchlist, getBankroll, setBankroll } from './session.js';
import { FLIP_SORTS } from './types.js';
const statusEl = document.getElementById('status');
const bodyEl = document.getElementById('flipBody');
const cardsEl = document.getElementById('flipCards');
const presetStrip = document.getElementById('presetStrip');
const FILTERS_KEY = 'osrs_flip_filters';
const ALL_COLUMN_KEYS = ['buy', 'sell', 'margin', 'tax', 'profit', 'roi', 'limit', 'profitPerLimit', 'capital', 'volume', 'age', 'confidence', 'realisticProfit'];
// The built-in starting point. A user can overwrite "the default" via Set as
// Default (saved to DEFAULT_COLUMNS_KEY) and restore this via Reset to Factory
// Default - column choices are NOT auto-persisted on every toggle any more,
// so a refresh always lands on whichever of these two is currently "the default".
const FACTORY_DEFAULT_COLUMNS = ['buy', 'sell', 'margin', 'profit', 'roi', 'volume'];
const DEFAULT_COLUMNS_KEY = 'osrs_flip_default_columns';
const DEFAULTS = {
    minVolume: 1000,
    minPrice: 50,
    maxPrice: '',
    minMargin: 0,
    minRoi: 0,
    maxAgeMinutes: '',
    membersOnly: 'all',
    pageSize: 50,
    sort: 'profitPerLimit',
    sortDir: 'desc'
};
// First-click direction per key: numeric columns lead with "best/highest
// first" (matches the table's original single-direction behavior); the name
// column leads with A-Z since that's what "alphabetical" means to most people.
function defaultSortDir(key) {
    return key === 'name' ? 'asc' : 'desc';
}
const PRESETS = {
    volume: { minVolume: 100000, maxAgeMinutes: 10, sort: 'profitPerLimit' },
    margin: { minMargin: 50000, minVolume: 100, sort: 'profit' },
    roi: { minRoi: 3, minVolume: 10000, sort: 'roi' },
    f2p: { membersOnly: 'f2p' },
    cheap: { maxPrice: 1000, minVolume: 500000 },
    bankroll: { sort: 'realisticProfit' },
    watchlist: {}
};
// idsFromUrl is set by GE "Flip" deep-links (?ids=4151) and bypasses filters.
// page/totalPages track the current results page; reset to page 1 whenever
// the underlying result set could change (new filters, sort, preset, page size).
const state = {
    sort: DEFAULTS.sort ?? 'profitPerLimit',
    sortDir: DEFAULTS.sortDir ?? 'desc',
    preset: null,
    idsFromUrl: null,
    page: 1,
    totalPages: 1
};
let calculatorSelection = null;
let activeResultView = null;
let pendingCalculatorItemId = null;
// Starting column set for a fresh page load: the user's saved default if
// they've set one via "Set as Default", otherwise FACTORY_DEFAULT_COLUMNS.
// Checkbox toggles during the session are scratch-only (see the columnsPanel
// change listener below) - only Set as Default writes to DEFAULT_COLUMNS_KEY.
function loadVisibleColumns() {
    const parsed = safeJsonParse(localStorage.getItem(DEFAULT_COLUMNS_KEY), []);
    const valid = parsed.filter((k) => ALL_COLUMN_KEYS.includes(k));
    return valid.length ? new Set(valid) : new Set(FACTORY_DEFAULT_COLUMNS);
}
let visibleColumns = loadVisibleColumns();
// Realistic Profit is only ever meaningful with a bankroll set, so it's
// gated by both the checkbox AND this flag (set from renderRows each render).
// Tracked here rather than re-checked only at render time so toggling the
// checkbox itself (no re-render involved) still respects it.
let bankrollOnForColumns = false;
// Purely visual - hides/shows already-rendered <th>/<td> cells and syncs the
// checkbox panel. No re-fetch needed since the data is already in the DOM.
// Scoped to #flipTable: the checkboxes in #columnsPanel also carry data-col
// (to say which column they control, not to be hidden themselves) - a bare
// `[data-col]` selector would match those checkboxes too and hide them
// whenever their own column was off, making them impossible to switch back on.
function applyColumnVisibility() {
    document.querySelectorAll('#flipTable [data-col]').forEach((cell) => {
        const key = cell.dataset.col;
        const visible = key === 'realisticProfit'
            ? visibleColumns.has(key) && bankrollOnForColumns
            : visibleColumns.has(key);
        cell.hidden = !visible;
    });
    document.querySelectorAll('#columnsPanel input[type="checkbox"]').forEach((cb) => {
        cb.checked = visibleColumns.has(cb.dataset.col);
    });
}
function readFiltersFromForm() {
    return {
        minVolume: el('minVolume').value,
        minPrice: el('minPrice').value,
        maxPrice: el('maxPrice').value,
        minMargin: el('minMargin').value,
        minRoi: el('minRoi').value,
        maxAgeMinutes: el('maxAgeMinutes').value,
        membersOnly: el('membersOnly').value,
        pageSize: el('pageSize').value,
        sort: state.sort,
        sortDir: state.sortDir
    };
}
function applyFiltersToForm(filters, bankroll) {
    el('minVolume').value = String(filters.minVolume ?? DEFAULTS.minVolume);
    el('minPrice').value = String(filters.minPrice ?? DEFAULTS.minPrice);
    el('maxPrice').value = filters.maxPrice != null ? String(filters.maxPrice) : '';
    el('minMargin').value = String(filters.minMargin ?? DEFAULTS.minMargin);
    el('minRoi').value = String(filters.minRoi ?? DEFAULTS.minRoi);
    el('maxAgeMinutes').value = filters.maxAgeMinutes != null ? String(filters.maxAgeMinutes) : '';
    el('membersOnly').value = filters.membersOnly ?? 'all';
    el('pageSize').value = String(filters.pageSize ?? 50);
    if (bankroll)
        el('bankroll').value = String(bankroll);
    if (filters.sort)
        state.sort = filters.sort;
    state.sortDir = filters.sortDir ?? defaultSortDir(state.sort);
    syncSortSelect();
    updateSortUi();
}
function syncSortSelect() {
    const sel = document.getElementById('flipSort');
    if (sel)
        sel.value = state.sort;
}
// Arrow indicator on the active table header + the direction button's label.
function updateSortUi() {
    document.querySelectorAll('#flipTable th[data-sort]').forEach((th) => {
        const active = th.dataset.sort === state.sort;
        th.classList.toggle('sort-active', active);
        th.classList.toggle('sort-asc', active && state.sortDir === 'asc');
        th.classList.toggle('sort-desc', active && state.sortDir === 'desc');
    });
    const dirBtn = document.getElementById('sortDirBtn');
    if (dirBtn)
        dirBtn.textContent = state.sortDir === 'desc' ? '↓ High to low' : '↑ Low to high';
}
// Shared by header clicks and the mobile Sort dropdown: re-picking the
// current key flips direction, picking a new one resets to its default.
function applySort(key) {
    if (state.sort === key) {
        state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    }
    else {
        state.sort = key;
        state.sortDir = defaultSortDir(key);
    }
    syncSortSelect();
    updateSortUi();
    state.page = 1;
    load();
}
// Last-used filter row + bankroll survive reloads. Bankroll is per-user via session.ts.
function persistFilters() {
    const filters = readFiltersFromForm();
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    const bankroll = Number(el('bankroll').value);
    if (Number.isFinite(bankroll))
        setBankroll(bankroll);
}
function restoreFilters() {
    const filters = safeJsonParse(localStorage.getItem(FILTERS_KEY), DEFAULTS);
    if (filters.sort && !FLIP_SORTS.includes(filters.sort)) {
        filters.sort = DEFAULTS.sort;
    }
    applyFiltersToForm(filters, getBankroll());
}
function setPresetActive(name) {
    state.preset = name;
    presetStrip.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.preset === name));
}
// Presets just write the filter inputs (resetting to DEFAULTS first) and reload.
function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset)
        return;
    applyFiltersToForm({ ...DEFAULTS, ...preset }, el('bankroll').value || getBankroll());
    setPresetActive(name);
    persistFilters();
    state.page = 1;
    load();
}
// Watchlist / ?ids= go through the ids= bypass so pinned rows aren't filtered out.
function buildQuery() {
    const f = readFiltersFromForm();
    const params = new URLSearchParams();
    const bankroll = Number(el('bankroll').value);
    if (bankroll > 0)
        params.set('bankroll', String(bankroll));
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
        if (!ids.length)
            return null;
        params.set('ids', ids.join(','));
        return params;
    }
    params.set('minVolume', String(f.minVolume || 0));
    params.set('minPrice', String(f.minPrice || 0));
    if (f.maxPrice !== '')
        params.set('maxPrice', String(f.maxPrice));
    params.set('minMargin', String(f.minMargin || 0));
    params.set('minRoi', String(f.minRoi || 0));
    if (f.maxAgeMinutes !== '')
        params.set('maxAgeMinutes', String(f.maxAgeMinutes));
    params.set('membersOnly', f.membersOnly || 'all');
    if (state.preset === 'bankroll' && bankroll > 0)
        params.set('maxCapital', String(bankroll));
    const search = el('flipSearch').value.trim();
    if (search)
        params.set('name', search);
    return params;
}
function watchedSet() {
    return new Set(getWatchlist());
}
function renderEmpty(message, colCount = 15) {
    bodyEl.innerHTML = `<tr><td colspan="${colCount}">${message}</td></tr>`;
    cardsEl.innerHTML = `<p class="status">${message}</p>`;
}
function renderPagination(page, totalPages) {
    state.page = page;
    state.totalPages = totalPages;
    el('pageIndicator').textContent = `Page ${page} of ${totalPages}`;
    el('pagePrev').disabled = page <= 1;
    el('pageNext').disabled = page >= totalPages;
}
function flipItemActions(item, watched) {
    const on = watched.has(item.id);
    return {
        buttons: `<button type="button" class="star-btn ${on ? 'on' : ''}" data-id="${item.id}" title="Watchlist">★</button>
        <button type="button" class="calc-btn" data-id="${item.id}" data-name="${escapeHtml(item.name)}" data-buy="${item.buy}" data-sell="${item.sell}" title="Use in calculator">🧮</button>`,
        link: `<a class="item-link" href="item.html?id=${item.id}">
          <img src="${item.icon}" alt="" />
          ${escapeHtml(item.name)}
        </a>`,
        conf: `<span class="conf-dot conf-${item.confidence}" title="${escapeHtml(item.confidenceWhy || item.confidence)}"></span>`
    };
}
function renderCard(item, watched, bankrollOn) {
    const { buttons, link, conf } = flipItemActions(item, watched);
    const realistic = bankrollOn
        ? `<div><dt>Realistic</dt><dd>${item.realisticProfit != null ? fmtGpShort(item.realisticProfit) : 'n/a'}</dd></div>`
        : '';
    return `
    <article class="flip-card" data-item-id="${item.id}">
      <div class="flip-card-head">
        ${buttons}
        ${link}
        ${conf}
      </div>
      <dl class="flip-card-grid">
        <div><dt>Buy</dt><dd>${fmtGp(item.buy)}</dd></div>
        <div><dt>Sell</dt><dd>${fmtGp(item.sell)}</dd></div>
        <div><dt>Margin</dt><dd>${fmtGp(item.margin)}</dd></div>
        <div><dt>ROI</dt><dd class="pct ${pctClass(item.roi)}">${fmtPct(item.roi)}</dd></div>
        <div><dt>Profit/limit</dt><dd>${fmtGp(item.profitPerLimit)}</dd></div>
        <div><dt>Vol/day</dt><dd>${fmt(item.volume24h)}</dd></div>
        <div><dt>Capital</dt><dd>${fmtGp(item.capital)}</dd></div>
        <div><dt>Age</dt><dd>${item.age != null ? fmtAgo(item.age) : 'n/a'}</dd></div>
        ${realistic}
      </dl>
    </article>`;
}
function renderRows(items, bankrollOn) {
    const watched = watchedSet();
    bankrollOnForColumns = bankrollOn;
    const colCount = 2 + ALL_COLUMN_KEYS.length;
    if (!items.length) {
        renderEmpty('No items match.', colCount);
        applyColumnVisibility();
        return;
    }
    bodyEl.innerHTML = items.map((item) => {
        const { buttons, link, conf } = flipItemActions(item, watched);
        const realisticText = bankrollOn && item.realisticProfit != null ? fmtGpShort(item.realisticProfit) : 'n/a';
        return `<tr data-item-id="${item.id}">
      <td>
        ${buttons}
      </td>
      <td>
        ${link}
      </td>
      <td data-col="buy">${fmtGp(item.buy)}</td>
      <td data-col="sell">${fmtGp(item.sell)}</td>
      <td data-col="margin">${fmtGp(item.margin)}</td>
      <td data-col="tax">${fmtGp(item.tax)}</td>
      <td data-col="profit">${fmtGp(item.profit)}</td>
      <td data-col="roi" class="pct ${pctClass(item.roi)}">${fmtPct(item.roi)}</td>
      <td data-col="limit">${item.limit ? fmt(item.limit) : 'n/a'}</td>
      <td data-col="profitPerLimit">${fmtGp(item.profitPerLimit)}</td>
      <td data-col="capital">${fmtGp(item.capital)}</td>
      <td data-col="volume">${fmt(item.volume24h)}</td>
      <td data-col="age">${item.age != null ? fmtAgo(item.age) : 'n/a'}</td>
      <td data-col="confidence">${conf}</td>
      <td data-col="realisticProfit">${realisticText}</td>
    </tr>`;
    }).join('');
    cardsEl.innerHTML = items.map((item) => renderCard(item, watched, bankrollOn)).join('');
    applyColumnVisibility();
}
async function load() {
    persistFilters();
    const params = buildQuery();
    if (!params) {
        renderEmpty('Watchlist is empty — star items to pin them here.');
        renderPagination(1, 1);
        statusEl.textContent = '';
        activeResultView = null;
        return false;
    }
    // Capture the controls that produced this request now: Scan-gated fields can
    // be edited again while the request is in flight without changing its results.
    const requestedView = {
        page: state.page,
        filters: { ...readFiltersFromForm() },
        bankroll: el('bankroll').value,
        search: el('flipSearch').value,
        preset: state.preset,
        idsFromUrl: state.idsFromUrl ? [...state.idsFromUrl] : null
    };
    statusEl.textContent = 'Scanning...';
    statusEl.classList.remove('error');
    try {
        const { ok, data } = await fetchJson(`/api/ge/flips?${params}`);
        if (!ok)
            throw new Error(data.error || 'Scan failed');
        const bankrollOn = Number(el('bankroll').value) > 0;
        const items = data.items || [];
        renderRows(items, bankrollOn);
        renderPagination(data.page, data.totalPages);
        activeResultView = { ...requestedView, page: data.page };
        statusEl.textContent = `${data.consideredCount} item(s) considered · showing ${items.length} (page ${data.page} of ${data.totalPages}, cached ~5 min).`;
        // A single-item GE Flip link behaves like clicking that row's calculator button.
        if (pendingCalculatorItemId !== null) {
            const item = items.find((candidate) => candidate.id === pendingCalculatorItemId);
            pendingCalculatorItemId = null;
            if (item)
                loadIntoCalculator(item.id, item.name, item.buy, item.sell);
        }
        return true;
    }
    catch (err) {
        statusEl.textContent = errorMessage(err, 'Scan failed');
        statusEl.classList.add('error');
        return false;
    }
}
// Pure client-side; uses geTax so the numbers agree with the table
// for non-exempt items. No item name here, so exemptions don't apply.
function updateCalc() {
    const buy = Number(el('calcBuy').value);
    const sell = Number(el('calcSell').value);
    const qty = Math.max(1, Number(el('calcQty').value) || 1);
    if (!buy || !sell) {
        el('calcTax').textContent = 'n/a';
        el('calcProfit').textContent = 'n/a';
        el('calcRoi').textContent = 'n/a';
        el('calcCapital').textContent = 'n/a';
        return;
    }
    const taxEach = geTax(sell);
    const profitEach = sell - buy - taxEach;
    el('calcTax').textContent = fmtGp(taxEach * qty);
    el('calcProfit').textContent = fmtGp(profitEach * qty);
    el('calcRoi').textContent = fmtPct(buy ? (profitEach / buy) * 100 : null);
    el('calcCapital').textContent = fmtGp(buy * qty);
}
// "Use in calculator" copies an item's buy/sell into the calc fields and
// scrolls the calculator into view. Qty is left as-is — clobbering a
// quantity the user is mid-typing would be more surprising than useful.
function loadIntoCalculator(id, name, buy, sell) {
    calculatorSelection = activeResultView
        ? {
            ...activeResultView,
            id,
            filters: { ...activeResultView.filters },
            idsFromUrl: activeResultView.idsFromUrl ? [...activeResultView.idsFromUrl] : null
        }
        : null;
    el('calcBuy').value = String(buy);
    el('calcSell').value = String(sell);
    el('calcSelectedLabel').textContent = name ? ` — ${name}` : '';
    el('returnToItemBtn').hidden = !calculatorSelection;
    updateCalc();
    el('calcHeading').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Restore the result view captured with the calculator selection before
// scrolling, so pagination or later filter changes cannot strand the item.
async function returnToCalculatorItem() {
    const selection = calculatorSelection;
    if (!selection)
        return;
    clearTimeout(searchTimer);
    applyFiltersToForm(selection.filters);
    el('bankroll').value = selection.bankroll;
    el('flipSearch').value = selection.search;
    setPresetActive(selection.preset);
    state.idsFromUrl = selection.idsFromUrl ? [...selection.idsFromUrl] : null;
    state.page = selection.page;
    const returnBtn = el('returnToItemBtn');
    returnBtn.disabled = true;
    const loaded = await load();
    returnBtn.disabled = false;
    if (!loaded)
        return;
    const itemContainer = window.matchMedia('(max-width: 700px)').matches ? cardsEl : bodyEl;
    const target = itemContainer.querySelector(`[data-item-id="${selection.id}"]`);
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
presetStrip.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});
// Scan clears a GE deep-link so the current filter row is used, but keeps
// watchlist / bankroll presets active.
function rescan() {
    pendingCalculatorItemId = null;
    state.idsFromUrl = null;
    if (state.preset !== 'watchlist' && state.preset !== 'bankroll') {
        setPresetActive(null);
    }
    state.page = 1;
    load();
}
el('scanBtn').addEventListener('click', rescan);
el('returnToItemBtn').addEventListener('click', () => void returnToCalculatorItem());
// Item name search - live, debounced, unlike every other filter (which only
// applies on Scan click). Reuses the same rescan() path so it interacts with
// presets/deep-links the same way clicking Scan would.
let searchTimer;
el('flipSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(rescan, 300);
});
// Header click re-requests with that sort so ranking is over the whole set,
// not the page. Clicking the already-active column flips its direction.
document.querySelectorAll('#flipTable th[data-sort]').forEach((th) => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => applySort(th.dataset.sort));
});
el('flipSort').addEventListener('change', () => {
    applySort(el('flipSort').value);
});
// Explicit direction flip for whatever's currently sorted - the only way to
// reverse direction on mobile, where the table (and its clickable headers) is hidden.
el('sortDirBtn').addEventListener('click', () => {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    updateSortUi();
    state.page = 1;
    load();
});
// Per-page select and Prev/Next paging. Prev/Next are disabled at the bounds
// by renderPagination(), but guard here too in case a stale click slips through.
el('pageSize').addEventListener('change', () => {
    state.page = 1;
    load();
});
el('pagePrev').addEventListener('click', () => {
    if (state.page <= 1)
        return;
    state.page -= 1;
    load();
});
el('pageNext').addEventListener('click', () => {
    if (state.page >= state.totalPages)
        return;
    state.page += 1;
    load();
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
    const cb = ev.target;
    if (cb.type !== 'checkbox')
        return;
    const key = cb.dataset.col;
    if (cb.checked)
        visibleColumns.add(key);
    else
        visibleColumns.delete(key);
    applyColumnVisibility();
});
// Set as Default: click once to arm it, click again within 5s to confirm -
// mirrors a "are you sure?" prompt without a native dialog. Any other trigger
// (timeout or Reset) cancels the armed state via cancelSetDefaultArmed().
let setDefaultArmTimer = null;
function cancelSetDefaultArmed() {
    if (setDefaultArmTimer !== null) {
        clearTimeout(setDefaultArmTimer);
        setDefaultArmTimer = null;
    }
    el('setDefaultBtn').textContent = 'Set as Default';
}
function showColumnsStatus(message) {
    el('columnsDefaultStatus').textContent = message;
    setTimeout(() => {
        if (el('columnsDefaultStatus').textContent === message)
            el('columnsDefaultStatus').textContent = '';
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
    localStorage.setItem(DEFAULT_COLUMNS_KEY, JSON.stringify([...visibleColumns]));
    el('setDefaultBtn').textContent = 'Set as Default';
    showColumnsStatus('Saved - this column set now loads by default.');
});
el('resetDefaultBtn').addEventListener('click', () => {
    cancelSetDefaultArmed();
    localStorage.removeItem(DEFAULT_COLUMNS_KEY);
    visibleColumns = new Set(FACTORY_DEFAULT_COLUMNS);
    applyColumnVisibility();
    showColumnsStatus('Reset to the factory default columns.');
});
// Star toggles the per-user watchlist on table and cards. Watchlist preset
// reloads so unstars drop out of the list. Calc button loads that item's
// buy/sell into the Flip calculator below.
document.getElementById('flipResults').addEventListener('click', (ev) => {
    const target = ev.target;
    const starBtn = target.closest('.star-btn');
    if (starBtn) {
        const id = Number(starBtn.dataset.id);
        toggleWatchlist(id);
        const on = getWatchlist().includes(id);
        document.querySelectorAll(`.star-btn[data-id="${id}"]`).forEach((b) => b.classList.toggle('on', on));
        if (state.preset === 'watchlist')
            load();
        return;
    }
    const calcBtn = target.closest('.calc-btn');
    if (!calcBtn)
        return;
    loadIntoCalculator(Number(calcBtn.dataset.id), calcBtn.dataset.name ?? '', Number(calcBtn.dataset.buy), Number(calcBtn.dataset.sell));
});
['calcBuy', 'calcSell', 'calcQty'].forEach((id) => {
    el(id).addEventListener('input', updateCalc);
});
// GE Flip links land here as ?ids= so the scanner shows that item live.
const urlIds = new URLSearchParams(location.search).get('ids');
if (urlIds) {
    const ids = urlIds.split(',').map(Number).filter(Number.isInteger);
    state.idsFromUrl = ids;
    pendingCalculatorItemId = ids.length === 1 ? ids[0] : null;
}
// Switching "Playing as" swaps the watchlist and bankroll buckets.
window.addEventListener('osrs-session-change', () => {
    el('bankroll').value = String(getBankroll() || '');
    state.page = 1;
    load();
});
restoreFilters();
applyColumnVisibility();
load();
updateCalc();
