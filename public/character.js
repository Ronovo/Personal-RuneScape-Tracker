// Character hiscores page. Username box is pre-filled from OsrsSession when set.
const usernameInput = document.getElementById('username');
const searchBtn = document.getElementById('searchBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

if (window.OsrsSession?.getUsername()) {
  usernameInput.value = window.OsrsSession.getUsername();
}

const { fmt } = window.OsrsFormat;

function renderSkills(skills) {
  const rows = skills.map((s) => `
    <tr>
      <td>${s.name}</td>
      <td>${s.level}</td>
      <td>${fmt(s.xp)}</td>
      <td>${s.rank ? fmt(s.rank) : '-'}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Skill</th><th>Level</th><th>XP</th><th>Rank</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderScored(entries, label) {
  if (!entries.length) return `<p class="status">No ranked ${label} yet.</p>`;
  const rows = entries.map((e) => `
    <tr>
      <td>${e.name}</td>
      <td>${fmt(e.score)}</td>
      <td>${e.rank ? fmt(e.rank) : '-'}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>${label}</th><th>Score / KC</th><th>Rank</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Same submenu pattern the item-page range strip copies.
function activateTab(tab) {
  document.querySelectorAll('.submenu button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${tab}`));
}

document.querySelectorAll('.submenu button').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

async function search() {
  const username = usernameInput.value.trim();
  if (!username) return;

  statusEl.textContent = 'Loading...';
  statusEl.classList.remove('error');
  resultEl.hidden = true;

  try {
    const res = await fetch(`/api/hiscores/${encodeURIComponent(username)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');

    document.getElementById('combatLevel').textContent = data.combatLevel;
    document.getElementById('totalLevel').textContent = fmt(data.totalLevel);
    document.getElementById('totalXp').textContent = fmt(data.totalXp);

    document.getElementById('tab-skills').innerHTML = renderSkills(data.skills);
    document.getElementById('tab-bosses').innerHTML = renderScored(data.bosses, 'Boss');
    document.getElementById('tab-minigames').innerHTML = renderScored(data.minigames, 'Minigame');
    document.getElementById('tab-others').innerHTML = renderScored(data.others, 'Activity');

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
