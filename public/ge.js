// Grand Exchange movers grid + item search.
const statusEl = document.getElementById('status');
const gridEl = document.getElementById('grid');
const gridTitleEl = document.getElementById('gridTitle');
const searchInput = document.getElementById('itemSearch');
const directionButtons = document.querySelectorAll('#directionToggle button');

const GRID_SIZE = 25;
const { fmtGp, fmtPct, fmtGpShort, escapeHtml } = window.OsrsFormat;

const state = {
  direction: 'risers' // only meaningful outside search mode
};

// Card is a div (not a single <a>) so the item link and Flip link can coexist.
function itemCell(item) {
  const pct = item.pctChange;
  const pctHtml = pct === null || pct === undefined
    ? ''
    : `<span class="pct ${pct >= 0 ? 'up' : 'down'}">${fmtPct(pct)}</span>`;
  const priceHtml = item.currentPrice ? fmtGp(item.currentPrice) : 'n/a';
  const margin = item.marginAfterTax != null ? fmtGpShort(item.marginAfterTax) : null;
  const metaBits = [];
  if (margin) metaBits.push(`${margin} after tax`);
  if (item.volume24h != null) metaBits.push(`${Number(item.volume24h).toLocaleString('en-US')} /day`);
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

function renderGrid(items) {
  gridEl.innerHTML = items.length
    ? items.map(itemCell).join('')
    : '<p class="status">No items match.</p>';
}

// Builds the movers query from the filter row. Empty max-price is omitted so
// the server treats it as "no cap" rather than 0.
function filterQuery() {
  const minVolume = document.getElementById('minVolume').value;
  const minPrice = document.getElementById('minPrice').value;
  const maxPrice = document.getElementById('maxPrice').value;
  const minMargin = document.getElementById('minMargin').value;
  const minRoi = document.getElementById('minRoi').value;
  const membersOnly = document.getElementById('membersOnly').value;
  const sort = document.getElementById('sortBy').value;
  const hideStale = document.getElementById('hideStale').checked ? '1' : '0';
  const params = new URLSearchParams({
    minVolume, minPrice, minMargin, minRoi, membersOnly, sort, hideStale, limit: String(GRID_SIZE)
  });
  if (maxPrice) params.set('maxPrice', maxPrice);
  return params;
}

async function loadMovers() {
  gridTitleEl.textContent = state.direction === 'risers' ? 'Rising (24h)' : 'Dropping (24h)';
  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');

  try {
    const res = await fetch(`/api/ge/movers?${filterQuery()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load movers');

    renderGrid(data[state.direction]);
    statusEl.textContent = `${data.consideredCount} items matched your filters (prices cached ~5 min).`;
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
  }
}

// Name search replaces the movers grid until the box is cleared.
async function loadSearch(query) {
  gridTitleEl.textContent = `Search: "${query}"`;
  statusEl.textContent = 'Searching...';
  statusEl.classList.remove('error');

  try {
    const res = await fetch(`/api/ge/search?q=${encodeURIComponent(query)}`);
    const results = await res.json();
    if (!res.ok) throw new Error(results.error || 'Search failed');

    renderGrid(results.slice(0, GRID_SIZE));
    statusEl.textContent = `${results.length} item(s) found.`;
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
  }
}

function setDirection(dir) {
  state.direction = dir;
  directionButtons.forEach((b) => b.classList.toggle('active', b.dataset.dir === dir));
}

function isSearching() {
  return searchInput.value.trim().length > 0;
}

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  // Debounce so we don't fire a search on every keystroke.
  searchTimer = setTimeout(() => {
    if (q) {
      loadSearch(q);
    } else {
      setDirection('risers');
      loadMovers();
    }
  }, 300);
});

directionButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    searchInput.value = '';
    setDirection(btn.dataset.dir);
    loadMovers();
  });
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  if (isSearching()) {
    loadSearch(searchInput.value.trim());
  } else {
    loadMovers();
  }
});

loadMovers();
