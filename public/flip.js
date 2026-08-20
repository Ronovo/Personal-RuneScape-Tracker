// Flip Helper: ranked GE scanner, presets, watchlist, and a client-side calculator.
const statusEl = document.getElementById('status');
const bodyEl = document.getElementById('flipBody');
const cardsEl = document.getElementById('flipCards');
const presetStrip = document.getElementById('presetStrip');
const FILTERS_KEY = 'osrs_flip_filters';

const {
  fmt, fmtGp, fmtGpShort, fmtPct, fmtAgo, pctClass, escapeHtml, geTax
} = window.OsrsFormat;

const DEFAULTS = {
  minVolume: 1000,
  minPrice: 50,
  maxPrice: '',
  minMargin: 0,
  minRoi: 0,
  maxAgeMinutes: '',
  membersOnly: 'all',
  limit: 50,
  sort: 'profitPerLimit'
};

const PRESETS = {
  volume: { minVolume: 100000, maxAgeMinutes: 10, sort: 'profitPerLimit' },
  margin: { minMargin: 50000, minVolume: 100, sort: 'profit' },
  roi: { minRoi: 3, minVolume: 10000, sort: 'roi' },
  f2p: { membersOnly: 'f2p' },
  cheap: { maxPrice: 1000, minVolume: 500000 },
  bankroll: { sort: 'realisticProfit', fitsBankroll: true },
  watchlist: { watchlist: true }
};

// idsFromUrl is set by GE "Flip" deep-links (?ids=4151) and bypasses filters.
const state = {
  sort: DEFAULTS.sort,
  preset: null,
  idsFromUrl: null
};

function el(id) {
  return document.getElementById(id);
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
    limit: el('resultLimit').value,
    sort: state.sort
  };
}

function applyFiltersToForm(filters, bankroll) {
  el('minVolume').value = filters.minVolume ?? DEFAULTS.minVolume;
  el('minPrice').value = filters.minPrice ?? DEFAULTS.minPrice;
  el('maxPrice').value = filters.maxPrice ?? '';
  el('minMargin').value = filters.minMargin ?? DEFAULTS.minMargin;
  el('minRoi').value = filters.minRoi ?? DEFAULTS.minRoi;
  el('maxAgeMinutes').value = filters.maxAgeMinutes ?? '';
  el('membersOnly').value = filters.membersOnly ?? 'all';
  el('resultLimit').value = filters.limit ?? 50;
  if (bankroll) el('bankroll').value = bankroll;
  if (filters.sort) state.sort = filters.sort;
  syncSortSelect();
}

function syncSortSelect() {
  const sel = el('flipSort');
  if (sel) sel.value = state.sort;
}

// Last-used filter row + bankroll survive reloads. Bankroll is per-user via OsrsSession.
function persistFilters() {
  const filters = readFiltersFromForm();
  localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  const bankroll = Number(el('bankroll').value);
  if (Number.isFinite(bankroll)) window.OsrsSession?.setBankroll(bankroll);
}

function restoreFilters() {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (raw) applyFiltersToForm(JSON.parse(raw), window.OsrsSession?.getBankroll());
    else applyFiltersToForm(DEFAULTS, window.OsrsSession?.getBankroll());
  } catch {
    applyFiltersToForm(DEFAULTS, window.OsrsSession?.getBankroll());
  }
}

function setPresetActive(name) {
  state.preset = name;
  presetStrip.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.preset === name));
}

// Presets just write the filter inputs (resetting to DEFAULTS first) and reload.
function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  applyFiltersToForm({ ...DEFAULTS, ...preset }, el('bankroll').value || window.OsrsSession?.getBankroll());
  setPresetActive(name);
  persistFilters();
  load();
}

// Watchlist / ?ids= go through the ids= bypass so pinned rows aren't filtered out.
function buildQuery() {
  const f = readFiltersFromForm();
  const params = new URLSearchParams();
  const bankroll = Number(el('bankroll').value);
  if (bankroll > 0) params.set('bankroll', String(bankroll));
  params.set('sort', state.sort);
  params.set('limit', String(Math.min(Number(f.limit) || 50, 200)));

  const urlIds = state.idsFromUrl;
  const watch = state.preset === 'watchlist';
  if (urlIds?.length) {
    params.set('ids', urlIds.join(','));
    return params;
  }
  if (watch) {
    const ids = window.OsrsSession?.getWatchlist() ?? [];
    if (!ids.length) return null;
    params.set('ids', ids.join(','));
    return params;
  }

  params.set('minVolume', String(f.minVolume || 0));
  params.set('minPrice', String(f.minPrice || 0));
  if (f.maxPrice !== '') params.set('maxPrice', String(f.maxPrice));
  params.set('minMargin', String(f.minMargin || 0));
  params.set('minRoi', String(f.minRoi || 0));
  if (f.maxAgeMinutes !== '') params.set('maxAgeMinutes', String(f.maxAgeMinutes));
  params.set('membersOnly', f.membersOnly || 'all');
  if (state.preset === 'bankroll' && bankroll > 0) params.set('maxCapital', String(bankroll));
  return params;
}

function watchedSet() {
  return new Set(window.OsrsSession?.getWatchlist() ?? []);
}

function renderEmpty(message) {
  bodyEl.innerHTML = `<tr><td colspan="15">${message}</td></tr>`;
  cardsEl.innerHTML = `<p class="status">${message}</p>`;
}

function renderCard(item, watched, bankrollOn) {
  const on = watched.has(item.id);
  const realistic = bankrollOn
    ? `<div><dt>Realistic</dt><dd>${item.realisticProfit != null ? fmtGpShort(item.realisticProfit) : 'n/a'}</dd></div>`
    : '';
  return `
    <article class="flip-card">
      <div class="flip-card-head">
        <button type="button" class="star-btn ${on ? 'on' : ''}" data-id="${item.id}" title="Watchlist">★</button>
        <a class="item-link" href="item.html?id=${item.id}">
          <img src="${item.icon}" alt="" />
          ${escapeHtml(item.name)}
        </a>
        <span class="conf-dot conf-${item.confidence}" title="${escapeHtml(item.confidenceWhy || item.confidence)}"></span>
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

// Realistic-profit column only shows when a bankroll is set. Cards get the
// same rows so mobile can hide the 15-col table without losing the scan.
function renderRows(items, bankrollOn) {
  const watched = watchedSet();
  el('realisticHead').hidden = !bankrollOn;
  if (!items.length) {
    renderEmpty('No items match.');
    return;
  }
  bodyEl.innerHTML = items.map((item) => {
    const on = watched.has(item.id);
    const realistic = bankrollOn
      ? `<td>${item.realisticProfit != null ? fmtGpShort(item.realisticProfit) : 'n/a'}</td>`
      : '';
    return `<tr>
      <td><button type="button" class="star-btn ${on ? 'on' : ''}" data-id="${item.id}" title="Watchlist">★</button></td>
      <td>
        <a class="item-link" href="item.html?id=${item.id}">
          <img src="${item.icon}" alt="" />
          ${escapeHtml(item.name)}
        </a>
      </td>
      <td>${fmtGp(item.buy)}</td>
      <td>${fmtGp(item.sell)}</td>
      <td>${fmtGp(item.margin)}</td>
      <td>${fmtGp(item.tax)}</td>
      <td>${fmtGp(item.profit)}</td>
      <td class="pct ${pctClass(item.roi)}">${fmtPct(item.roi)}</td>
      <td>${item.limit ? fmt(item.limit) : 'n/a'}</td>
      <td>${fmtGp(item.profitPerLimit)}</td>
      <td>${fmtGp(item.capital)}</td>
      <td>${fmt(item.volume24h)}</td>
      <td>${item.age != null ? fmtAgo(item.age) : 'n/a'}</td>
      <td><span class="conf-dot conf-${item.confidence}" title="${escapeHtml(item.confidenceWhy || item.confidence)}"></span></td>
      ${realistic}
    </tr>`;
  }).join('');
  cardsEl.innerHTML = items.map((item) => renderCard(item, watched, bankrollOn)).join('');
}

async function load() {
  persistFilters();
  const params = buildQuery();
  if (!params) {
    renderEmpty('Watchlist is empty — star items to pin them here.');
    statusEl.textContent = '';
    return;
  }

  statusEl.textContent = 'Scanning...';
  statusEl.classList.remove('error');
  try {
    const res = await fetch(`/api/ge/flips?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');
    const bankrollOn = Number(el('bankroll').value) > 0;
    renderRows(data.items || [], bankrollOn);
    statusEl.textContent = `${data.consideredCount} item(s) considered · showing ${data.items.length} (cached ~5 min).`;
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
  }
}

// Pure client-side; uses OsrsFormat.geTax so the numbers agree with the table
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

presetStrip.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

// Scan clears a GE deep-link so the current filter row is used, but keeps
// watchlist / bankroll presets active.
el('scanBtn').addEventListener('click', () => {
  state.idsFromUrl = null;
  if (state.preset === 'watchlist' || state.preset === 'bankroll') {
    /* keep */
  } else {
    setPresetActive(null);
  }
  load();
});

// Header click re-requests with that sort so ranking is over the whole set, not the page.
document.querySelectorAll('#flipTable th[data-sort]').forEach((th) => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    state.sort = th.dataset.sort;
    syncSortSelect();
    load();
  });
});

el('flipSort').addEventListener('change', () => {
  state.sort = el('flipSort').value;
  load();
});

// Star toggles the per-user watchlist on table and cards. Watchlist preset
// reloads so unstars drop out of the list.
document.getElementById('flipResults').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.star-btn');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  window.OsrsSession.toggleWatchlist(id);
  const on = (window.OsrsSession.getWatchlist() ?? []).includes(id);
  document.querySelectorAll(`.star-btn[data-id="${id}"]`).forEach((b) => b.classList.toggle('on', on));
  if (state.preset === 'watchlist') load();
});

['calcBuy', 'calcSell', 'calcQty'].forEach((id) => {
  el(id).addEventListener('input', updateCalc);
});

// GE Flip links land here as ?ids= so the scanner shows that item live.
const urlIds = new URLSearchParams(location.search).get('ids');
if (urlIds) {
  state.idsFromUrl = urlIds.split(',').map(Number).filter(Number.isInteger);
}

// Switching "Playing as" swaps the watchlist and bankroll buckets.
window.addEventListener('osrs-session-change', () => {
  el('bankroll').value = window.OsrsSession?.getBankroll() || '';
  load();
});

restoreFilters();
load();
updateCalc();
