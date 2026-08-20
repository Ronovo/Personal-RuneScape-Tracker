// Lightweight "who's playing" selector - not authentication, just a
// persisted client-side identity used to scope the GE recent-items cache
// and pre-fill the username box on other pages. Everything lives in
// localStorage (not sessionStorage) so it survives tab/browser closes
// until the player is explicitly switched.
(function () {
  const CURRENT_USER_KEY = 'osrs_current_user';
  const KNOWN_USERS_KEY = 'osrs_known_users';
  const KNOWN_USERS_MAX = 15;
  const RECENT_ITEMS_MAX = 50;
  const GUEST_BUCKET = '_guest_';

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function getUsername() {
    return localStorage.getItem(CURRENT_USER_KEY) || null;
  }

  function getKnownUsers() {
    return readJson(KNOWN_USERS_KEY, []);
  }

  function setUsername(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem(CURRENT_USER_KEY, trimmed);

    const known = [trimmed, ...getKnownUsers().filter((n) => n.toLowerCase() !== trimmed.toLowerCase())].slice(0, KNOWN_USERS_MAX);
    localStorage.setItem(KNOWN_USERS_KEY, JSON.stringify(known));

    mountSessionBar();
    window.dispatchEvent(new Event('osrs-session-change'));
  }

  function recentItemsKey() {
    return `osrs_recent_items::${getUsername() || GUEST_BUCKET}`;
  }

  function getRecentItemIds() {
    return readJson(recentItemsKey(), []);
  }

  function rememberRecentItem(id) {
    const ids = [id, ...getRecentItemIds().filter((x) => x !== id)].slice(0, RECENT_ITEMS_MAX);
    localStorage.setItem(recentItemsKey(), JSON.stringify(ids));
  }

  function userKey(prefix) {
    return `${prefix}::${getUsername() || GUEST_BUCKET}`;
  }

  // Starred Flip Helper items, scoped per player (or guest) like recent items.
  function getWatchlist() {
    return readJson(userKey('osrs_flip_watchlist'), []);
  }

  function toggleWatchlist(id) {
    const numId = Number(id);
    const current = getWatchlist();
    const next = current.includes(numId)
      ? current.filter((x) => x !== numId)
      : [numId, ...current];
    localStorage.setItem(userKey('osrs_flip_watchlist'), JSON.stringify(next));
    return next;
  }

  // Bankroll for the Flip Helper "Fits My Bankroll" preset, same per-user bucket.
  function getBankroll() {
    const n = Number(localStorage.getItem(userKey('osrs_bankroll')));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function setBankroll(n) {
    const value = Number(n);
    if (!Number.isFinite(value) || value < 0) return getBankroll();
    localStorage.setItem(userKey('osrs_bankroll'), String(value));
    return value;
  }

  // Draws the "Playing as" chip / name box into #sessionBar on every page.
  function mountSessionBar() {
    const el = document.getElementById('sessionBar');
    if (!el) return;

    const username = getUsername();

    if (username) {
      el.innerHTML = `
        <span>Playing as <strong>${username}</strong></span>
        <button id="sessionSwitchBtn" type="button">Switch</button>`;
      document.getElementById('sessionSwitchBtn').addEventListener('click', () => {
        localStorage.removeItem(CURRENT_USER_KEY);
        mountSessionBar();
        window.dispatchEvent(new Event('osrs-session-change'));
      });
      return;
    }

    const known = getKnownUsers();
    el.innerHTML = `
      <input id="sessionUsernameInput" type="text" placeholder="Your OSRS name" autocomplete="off" list="sessionKnownUsers" />
      <datalist id="sessionKnownUsers">${known.map((n) => `<option value="${n}"></option>`).join('')}</datalist>
      <button id="sessionSetBtn" type="button">Play as</button>`;

    const input = document.getElementById('sessionUsernameInput');
    const submit = () => setUsername(input.value);
    document.getElementById('sessionSetBtn').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  window.OsrsSession = {
    getUsername, setUsername, getKnownUsers, getRecentItemIds, rememberRecentItem, mountSessionBar,
    getWatchlist, toggleWatchlist, getBankroll, setBankroll
  };

  document.addEventListener('DOMContentLoaded', mountSessionBar);
})();
