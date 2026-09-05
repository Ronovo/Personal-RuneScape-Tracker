// Item detail page: stats tiles + range-aware chart.

import './chrome.js';
import {
  fmt, fmtGp, fmtPct, pctClass, fmtAgoSince, agoClass, escapeHtml, fetchJson,
  errorMessage, safeJsonParse, el, storageGet, storageSet
} from './format.js';
import { render as renderChart } from './chart.js';
import type { ItemDetail, PriceRange, ApiErrorBody } from './types.js';

const statusEl = el('status');
const resultEl = el('result');
const chartSection = el('chartSection');
const chartEl = el('chart');
const rangeToggle = el('rangeToggle');
const flipLink = el<HTMLAnchorElement>('flipLink');

const CACHE_TTL_MS = 60 * 1000;
const RANGE_KEY = 'osrs_item_range';
const RANGES: PriceRange[] = ['1d', '1w', '1m', '3m', '1y'];
// Keep the last payload in memory so series toggles can re-draw without a refetch.
let lastData: ItemDetail | null = null;

function getRange(): PriceRange {
  const stored = storageGet(localStorage, RANGE_KEY);
  return (RANGES as string[]).includes(stored ?? '') ? (stored as PriceRange) : '1w';
}

function setRange(range: PriceRange): void {
  storageSet(localStorage, RANGE_KEY, range);
  rangeToggle.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.range === range));
}

// sessionStorage, keyed by id AND range, so switching 1W → 1M doesn't show stale points.
function getCached(id: number, range: PriceRange): ItemDetail | null {
  const entry = safeJsonParse<{ at: number; data: ItemDetail } | null>(
    storageGet(sessionStorage, `ge_item_${id}_${range}`), null
  );
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry.data;
}

// A year of history is a large payload and five ranges per item add up, so
// this is the one store here that realistically hits its quota. Failing to
// cache is not a failure to load - storageSet swallows it, so a full store
// cannot turn a successful fetch into "Failed to load item".
function setCached(id: number, range: PriceRange, data: ItemDetail): void {
  storageSet(sessionStorage, `ge_item_${id}_${range}`, JSON.stringify({ at: Date.now(), data }));
}

function tile(value: string, label: string, valueClass = '', tooltip = ''): string {
  const cls = valueClass ? ` class="${valueClass}"` : '';
  const tip = tooltip ? ` class="stat-tip" title="${escapeHtml(tooltip)}"` : '';
  // Hand-drawn SVG "i" badge - crisper and font-independent vs. the ⓘ glyph.
  const cue = tooltip
    ? ' <svg class="info-cue" aria-hidden="true" viewBox="0 0 16 16" width="12" height="12">'
      + '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" />'
      + '<circle cx="8" cy="4.7" r="1.05" fill="currentColor" />'
      + '<path d="M8 7.2v5.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />'
      + '</svg>'
    : '';
  return `<div${tip}><strong${cls}>${value}</strong><span class="stat-label">${label}${cue}</span></div>`;
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
  const state: SeriesState = { high: true, low: true, volume: true, smooth: false };
  document.querySelectorAll<HTMLInputElement>('#seriesToggles input').forEach((input) => {
    state[input.dataset.series as SeriesKey] = input.checked;
  });
  return state;
}

function drawChart(data: ItemDetail): void {
  renderChart(chartEl, {
    points: data.history ?? [],
    range: data.range ?? getRange(),
    series: seriesState(),
    rangeHigh: data.rangeHigh,
    rangeLow: data.rangeLow,
    rangeAvg: data.rangeAvg
  });
}

function render(data: ItemDetail): void {
  lastData = data;
  document.title = `${data.name} - OSRS Tracker`;
  const name = escapeHtml(data.name);
  const examine = escapeHtml(data.examine ?? '');
  const r = (data.range ?? getRange()).toUpperCase(); // 1D / 1W / 1M / 3M / 1Y

  resultEl.innerHTML = `
    <div class="item-header">
      <img src="${escapeHtml(data.icon)}" alt="" />
      <div>
        <h2>${name} ${data.members ? '<span class="badge">Members</span>' : ''}</h2>
        <p class="examine">${examine}</p>
      </div>
    </div>

    <div class="summary item-stats">
      <div class="stat-group">Pricing Information</div>
      ${tile(fmtGp(data.high), 'Insta-Buy (High)')}
      ${tile(fmtGp(data.low), 'Insta-Sell (Low)')}
      ${tile(fmtPct(data.pctChangeRange), `Change (${r})`, `pct ${pctClass(data.pctChangeRange)}`,
        `Percent change from the first recorded price in the selected chart range to the current insta-buy price.`)}
      ${tile(data.pricePosition == null ? 'n/a' : `${Math.round(data.pricePosition)}%`, `Price Position (${r})`, '',
        `Where the current price sits within the selected chart range: 0% is the range low, 100% is the range high.`)}

      <div class="stat-group">Flipping Information</div>
      ${tile(fmtGp(data.margin), 'Margin (High − Low)')}
      ${tile(data.taxExempt ? '0 gp (exempt)' : fmtGp(data.tax), 'GE Tax')}
      ${tile(fmtGp(data.marginAfterTax), 'Margin After Tax')}
      ${tile(fmtPct(data.roi), 'ROI', `pct ${pctClass(data.roi)}`)}
      ${tile(data.buyLimit ? fmt(data.buyLimit) : 'n/a', 'Buy Limit (4h)')}
      ${tile(fmtGp(data.profitPerLimit), 'Profit at Buy Limit')}
      ${tile(fmtGp(data.capitalPerLimit), 'Capital for Buy Limit')}

      <div class="stat-group">Activity</div>
      ${tile(fmt(data.volume24h), 'Daily Volume')}
      ${tile(`${fmt(data.buyVolume24h)} / ${fmt(data.sellVolume24h)}`, 'Buy / Sell Volume')}
      ${tile(fmtAgoSince(data.highTime), 'Last Insta-Buy', agoClass(data.highTime))}
      ${tile(fmtAgoSince(data.lowTime), 'Last Insta-Sell', agoClass(data.lowTime))}

      <div class="stat-group">Alchemy Reference</div>
      ${tile(fmtGp(data.highalch), 'High Alch')}
      ${tile(fmtGp(data.lowalch), 'Low Alch')}
      ${tile(fmtGp(data.alchProfit), 'Alch Profit')}
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

  // A single id deep-links straight into the Flip Helper's calculator.
  flipLink.href = `flip.html?ids=${id}`;
  flipLink.hidden = false;

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
    void load();
  });
});

// Series / smooth toggles only re-render the SVG - they do not refetch.
document.querySelectorAll<HTMLInputElement>('#seriesToggles input').forEach((input) => {
  input.addEventListener('change', () => {
    if (lastData) drawChart(lastData);
  });
});

void load();
