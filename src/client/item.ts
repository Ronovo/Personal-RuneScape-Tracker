// Item detail page: stats tiles + range-aware chart.

import { fmt, fmtGp, fmtPct, pctClass, fmtAgo, agoClass, escapeHtml, fetchJson, errorMessage, safeJsonParse, el } from './format.js';
import { render as renderChart } from './chart.js';
import type { ItemDetail, PriceRange, ApiErrorBody } from './types.js';

const statusEl = el('status');
const resultEl = el('result');
const chartSection = el('chartSection');
const chartEl = el('chart');
const rangeToggle = el('rangeToggle');

const CACHE_TTL_MS = 60 * 1000;
const RANGE_KEY = 'osrs_item_range';
const RANGES: PriceRange[] = ['1d', '1w', '1m', '3m', '1y'];
// Keep the last payload in memory so series toggles can re-draw without a refetch.
let lastData: ItemDetail | null = null;

function getRange(): PriceRange {
  const stored = localStorage.getItem(RANGE_KEY);
  return (RANGES as string[]).includes(stored ?? '') ? (stored as PriceRange) : '1w';
}

function setRange(range: PriceRange): void {
  localStorage.setItem(RANGE_KEY, range);
  rangeToggle.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.range === range));
}

// sessionStorage, keyed by id AND range, so switching 1W → 1M doesn't show stale points.
function getCached(id: number, range: PriceRange): ItemDetail | null {
  const entry = safeJsonParse<{ at: number; data: ItemDetail } | null>(
    sessionStorage.getItem(`ge_item_${id}_${range}`), null
  );
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry.data;
}

function setCached(id: number, range: PriceRange, data: ItemDetail): void {
  sessionStorage.setItem(`ge_item_${id}_${range}`, JSON.stringify({ at: Date.now(), data }));
}

function tile(valueHtml: string, label: string): string {
  return `<div><strong>${valueHtml}</strong><span>${label}</span></div>`;
}

interface SeriesState {
  high: boolean;
  low: boolean;
  volume: boolean;
  smooth: boolean;
}

type SeriesKey = keyof SeriesState;

// Checkbox state is read at draw time so toggling series never hits the network.
function seriesState(): SeriesState {
  const state: SeriesState = { high: true, low: true, volume: false, smooth: false };
  document.querySelectorAll<HTMLInputElement>('#seriesToggles input').forEach((input) => {
    state[input.dataset.series as SeriesKey] = input.checked;
  });
  return state;
}

function drawChart(data: ItemDetail): void {
  renderChart(chartEl, {
    points: data.history ?? [],
    range: data.range ?? getRange(),
    series: seriesState()
  });
}

function render(data: ItemDetail): void {
  lastData = data;
  document.title = `${data.name} - OSRS Tracker`;
  const name = escapeHtml(data.name);
  const examine = escapeHtml(data.examine ?? '');

  resultEl.innerHTML = `
    <div class="item-header">
      <img src="${data.icon}" alt="" />
      <div>
        <h2>${name} ${data.members ? '<span class="badge">Members</span>' : ''}</h2>
        <p class="examine">${examine}</p>
      </div>
    </div>

    <div class="summary item-stats">
      <div class="stat-group">Price</div>
      ${tile(fmtGp(data.high), 'Insta-buy (high)')}
      ${tile(fmtGp(data.low), 'Insta-sell (low)')}
      ${tile(`<span class="pct ${pctClass(data.pctChangeRange)}">${fmtPct(data.pctChangeRange)}</span>`, 'Change (range)')}
      ${tile(data.pricePosition == null ? 'n/a' : `${Math.round(data.pricePosition)}%`, 'Price position in range')}

      <div class="stat-group">Flip</div>
      ${tile(fmtGp(data.margin), 'Margin (high − low)')}
      ${tile(data.taxExempt ? '0 gp (exempt)' : fmtGp(data.tax), 'GE tax')}
      ${tile(fmtGp(data.marginAfterTax), 'Margin after tax')}
      ${tile(`<span class="pct ${pctClass(data.roi)}">${fmtPct(data.roi)}</span>`, 'ROI')}
      ${tile(fmtGp(data.profitPerLimit), 'Profit at buy limit')}
      ${tile(fmtGp(data.capitalPerLimit), 'Capital for buy limit')}

      <div class="stat-group">Activity</div>
      ${tile(fmt(data.volume24h), 'Daily volume')}
      ${tile(`${fmt(data.buyVolume24h)} / ${fmt(data.sellVolume24h)}`, 'Buy / sell volume')}
      ${tile(data.buyLimit ? fmt(data.buyLimit) : 'n/a', 'Buy limit (4h)')}
      ${tile(`<span class="${agoClass(data.highTime)}">${fmtAgo(data.highTime)}</span>`, 'Last insta-buy')}
      ${tile(`<span class="${agoClass(data.lowTime)}">${fmtAgo(data.lowTime)}</span>`, 'Last insta-sell')}

      <div class="stat-group">Reference</div>
      ${tile(fmtGp(data.highalch), 'High alch')}
      ${tile(fmtGp(data.lowalch), 'Low alch')}
      ${tile(fmtGp(data.alchProfit), 'Alch profit')}
      ${tile(data.members ? 'Members' : 'F2P', 'Account type')}
    </div>

    <p class="status">${data.stale ? 'Prices look stale (&gt;30m since a trade) — treat the margin as indicative.' : ''}</p>
  `;
  resultEl.hidden = false;
  chartSection.hidden = false;
  drawChart(data);
}

async function load(): Promise<void> {
  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!Number.isInteger(id)) {
    statusEl.textContent = 'No item specified.';
    statusEl.classList.add('error');
    return;
  }

  const range = getRange();
  setRange(range);

  const cached = getCached(id, range);
  if (cached) {
    statusEl.textContent = '';
    statusEl.classList.remove('error');
    render(cached);
    return;
  }

  statusEl.textContent = 'Loading...';
  try {
    const { ok, data } = await fetchJson<ItemDetail & ApiErrorBody>(`/api/ge/item/${id}?range=${range}`);
    if (!ok) throw new Error(data.error || 'Failed to load item');

    setCached(id, range, data);
    statusEl.textContent = '';
    render(data);
  } catch (err) {
    statusEl.textContent = errorMessage(err, 'Failed to load item');
    statusEl.classList.add('error');
  }
}

rangeToggle.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    setRange(btn.dataset.range as PriceRange);
    load();
  });
});

// Series / smooth toggles only re-render the SVG - they do not refetch.
document.querySelectorAll<HTMLInputElement>('#seriesToggles input').forEach((input) => {
  input.addEventListener('change', () => {
    if (lastData) drawChart(lastData);
  });
});

load();
