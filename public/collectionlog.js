// Collection log browser. Data comes from TempleOSRS, not Jagex — a 404
// means the player hasn't synced, which we show as help rather than an error.
const usernameInput = document.getElementById('username');
const searchBtn = document.getElementById('searchBtn');
const statusEl = document.getElementById('status');
const syncHelpEl = document.getElementById('syncHelp');
const resultEl = document.getElementById('result');
const groupTabsEl = document.getElementById('groupTabs');
const groupsEl = document.getElementById('groups');
const gridTitleEl = document.getElementById('gridTitle');
const itemGridEl = document.getElementById('itemGrid');

if (window.OsrsSession?.getUsername()) {
  usernameInput.value = window.OsrsSession.getUsername();
}

const SYNC_HELP_HTML = `
  <p><strong>No synced collection log found for this name.</strong> TempleOSRS only has data for players who've synced their log at least once. To fix that:</p>
  <ol>
    <li>In RuneLite, open <strong>Configuration</strong> (wrench icon) &rarr; <strong>Plugin Hub</strong>, search "<strong>TempleOSRS</strong>", and install the plugin.</li>
    <li>Open your in-game <strong>Collection Log</strong> interface and click the sync button in its top-right corner.</li>
    <li>Make sure you have a profile on <a href="https://templeosrs.com" target="_blank" rel="noopener">templeosrs.com</a> for your name (search your name there and press Update if it says none exists).</li>
  </ol>
  <p>Once you've synced, search for your name again here, or just reload this page and search again.</p>`;

const { fmt } = window.OsrsFormat;

let groupsData = [];
let categoriesByKey = new Map();

function renderGroupPills(groupName) {
  const group = groupsData.find((g) => g.group === groupName);
  groupsEl.innerHTML = group.categories.map((c) => `
    <button class="cl-pill" data-key="${c.key}">${c.name} <span class="cl-count">${c.obtained}/${c.total}</span></button>
  `).join('');
}

function selectGroupTab(groupName) {
  groupTabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.group === groupName));
  renderGroupPills(groupName);
}

// Rebuild group tabs + the category lookup map after a successful fetch.
function setGroups(groups) {
  groupsData = groups;
  categoriesByKey = new Map();
  groups.forEach((g) => g.categories.forEach((c) => categoriesByKey.set(c.key, c)));

  groupTabsEl.innerHTML = groups.map((g, i) => `
    <button data-group="${g.group}" class="${i === 0 ? 'active' : ''}">${g.group}</button>
  `).join('');

  selectGroupTab(groups[0].group);
}

function renderCategoryGrid(category) {
  gridTitleEl.textContent = `${category.name} (${category.obtained}/${category.total})`;

  document.querySelectorAll('.cl-pill').forEach((b) => b.classList.toggle('active', b.dataset.key === category.key));

  itemGridEl.innerHTML = category.items.map((item) => `
    <div class="cl-slot ${item.count > 0 ? 'obtained' : 'missing'}">
      <img src="${item.icon}" alt="" loading="lazy" />
      <span class="name">${item.name}</span>
      ${item.count > 1 ? `<span class="count">&times;${fmt(item.count)}</span>` : ''}
    </div>
  `).join('');

  gridTitleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

groupTabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) selectGroupTab(btn.dataset.group);
});

groupsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.cl-pill');
  if (!btn) return;
  const category = categoriesByKey.get(btn.dataset.key);
  if (category) renderCategoryGrid(category);
});

async function search() {
  const username = usernameInput.value.trim();
  if (!username) return;

  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');
  syncHelpEl.hidden = true;
  resultEl.hidden = true;

  try {
    const res = await fetch(`/api/collectionlog/${encodeURIComponent(username)}`);
    const data = await res.json();

    // Not synced on TempleOSRS — show the how-to instead of a red error.
    if (res.status === 404) {
      statusEl.textContent = '';
      syncHelpEl.innerHTML = SYNC_HELP_HTML;
      syncHelpEl.hidden = false;
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Lookup failed');

    document.getElementById('itemsObtained').textContent = `${fmt(data.itemsObtained)} / ${fmt(data.itemsAvailable)}`;
    document.getElementById('categoriesFinished').textContent = `${fmt(data.categoriesFinished)} / ${fmt(data.categoriesAvailable)}`;
    document.getElementById('hiscoresRank').textContent = data.hiscoresRank ? fmt(data.hiscoresRank) : 'Unranked';

    setGroups(data.groups);

    // Grid starts empty until a category is picked.
    gridTitleEl.textContent = 'Pick a category below to see its items';
    itemGridEl.innerHTML = '';

    statusEl.textContent = '';
    resultEl.hidden = false;
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
  }
}

searchBtn.addEventListener('click', search);
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') search();
});
