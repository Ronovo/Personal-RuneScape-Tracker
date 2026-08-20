// Item detail page: stats tiles + range-aware chart.
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const chartSection = document.getElementById('chartSection');
const chartEl = document.getElementById('chart');
const rangeToggle = document.getElementById('rangeToggle');

const CACHE_TTL_MS = 60 * 1000;
const RANGE_KEY = 'osrs_item_range';
const { fmt, fmtGp, fmtPct, pctClass, fmtAgo, agoClass, escapeHtml } = window.OsrsFormat;
// Keep the last payload in memory so series toggles can re-draw without a refetch.
let lastData = null;

function getRange() {
  const stored = localStorage.getItem(RANGE_KEY);
  return ['1d', '1w', '1m', '3m', '1y'].includes(stored) ? stored : '1w';
}

function setRange(range) {
  localStorage.setItem(RANGE_KEY, range);
  rangeToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.range === range));
}

// sessionStorage, keyed by id AND range, so switching 1W → 1M doesn't show stale points.
function getCached(id, range) {
  try {
    const raw = sessionStorage.getItem(`ge_item_${id}_${range}`);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (Date.now() - at > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function setCached(id, range, data) {
  sessionStorage.setItem(`ge_item_${id}_${range}`, JSON.stringify({ at: Date.now(), data }));
}

function tile(valueHtml, label) {
  return `<div><strong>${valueHtml}</strong><span>${label}</span></div>`;
}

// Checkbox state is read at draw time so toggling series never hits the network.
function seriesState() {
  const state = { high: true, low: true, volume: false, smooth: false };
  document.querySelectorAll('#seriesToggles input').forEach((input) => {
    state[input.dataset.series] = input.checked;
  });
  return state;
}

function drawChart(data) {
  window.OsrsChart.render(chartEl, {
    points: data.history ?? [],
    range: data.range ?? getRange(),
    series: seriesState()
  });
}

function render(data) {
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

async function load() {
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
    render(cached);
    window.OsrsSession?.rememberRecentItem(id);
    return;
  }

  statusEl.textContent = 'Loading...';
  try {
    const res = await fetch(`/api/ge/item/${id}?range=${range}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load item');

    setCached(id, range, data);
    window.OsrsSession?.rememberRecentItem(id);
    statusEl.textContent = '';
    render(data);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
  }
}

rangeToggle.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    setRange(btn.dataset.range);
    load();
  });
});

// Series / smooth toggles only re-render the SVG - they do not refetch.
document.querySelectorAll('#seriesToggles input').forEach((input) => {
  input.addEventListener('change', () => {
    if (lastData) drawChart(lastData);
  });
});

setRange(getRange());
load();
