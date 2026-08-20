// Shared null-safe formatters. Loaded before each page script so character,
// collection log, GE, item, and Flip Helper all render numbers the same way.
(function () {
  const GE_TAX_RATE = 0.02;
  const GE_TAX_CAP = 5_000_000;

  function fmt(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
    return Number(n).toLocaleString('en-US');
  }

  function fmtGp(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
    return `${fmt(Math.round(n))} gp`;
  }

  // Compact labels for dense tables and chart axes: 1.2m / 450k / 1.2b.
  function fmtGpShort(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) {
      const v = abs / 1_000_000_000;
      return `${sign}${v >= 10 ? v.toFixed(0) : v.toFixed(1)}b`;
    }
    if (abs >= 1_000_000) {
      const v = abs / 1_000_000;
      return `${sign}${v >= 10 ? trimOne(v) : v.toFixed(1)}m`;
    }
    if (abs >= 1_000) {
      const v = abs / 1_000;
      return `${sign}${v >= 10 ? v.toFixed(0) : v.toFixed(1)}k`;
    }
    return `${sign}${Math.round(abs)}`;
  }

  function trimOne(v) {
    return v.toFixed(1).replace(/\.0$/, '');
  }

  function fmtPct(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  }

  function fmtTime(unixSec) {
    if (!unixSec) return 'n/a';
    return new Date(unixSec * 1000).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
  }

  function ageSeconds(unixSec) {
    if (!unixSec) return null;
    return Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  }

  // Accepts either a unix timestamp or an already-computed age in seconds
  // (flip rows send age; item tiles send highTime/lowTime).
  function fmtAgo(unixSec) {
    const sec = typeof unixSec === 'number' && unixSec < 1e10
      ? (unixSec > 1e8 ? ageSeconds(unixSec) : unixSec)
      : ageSeconds(unixSec);
    if (sec === null || Number.isNaN(sec)) return 'n/a';
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }

  // Green / amber / red for last-traded age tiles (fresh ≤10m, stale >30m).
  function agoClass(unixSec) {
    const sec = ageSeconds(unixSec);
    if (sec === null) return '';
    if (sec <= 10 * 60) return 'up';
    if (sec <= 30 * 60) return 'ago-amber';
    return 'down';
  }

  function pctClass(n) {
    return n === null || n === undefined || Number.isNaN(n) ? '' : n >= 0 ? 'up' : 'down';
  }

  // Everything in this app renders via innerHTML, so interpolated names
  // (search results, flip table) need escaping.
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Mirrors lib/prices.js geTax, without item-name exemptions — the calculator
  // only has buy/sell numbers, not an item.
  function geTax(price) {
    if (!price) return 0;
    return Math.min(Math.floor(price * GE_TAX_RATE), GE_TAX_CAP);
  }

  window.OsrsFormat = {
    fmt, fmtGp, fmtGpShort, fmtPct, fmtTime, fmtAgo, agoClass, pctClass, escapeHtml, geTax
  };
})();
