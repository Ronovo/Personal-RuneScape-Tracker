import express from 'express';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchHiscores } from './lib/hiscores.js';
import { getMovers, searchItems, getItemDetail, getFlipCandidates, normalizeRange } from './lib/prices.js';
import { fetchCollectionLog } from './lib/collectionlog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4123;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Query params come in as strings; NaN should fall back rather than leak into filters.
function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Jagex hiscores lookup (CSV index_lite.ws).
app.get('/api/hiscores/:username', async (req, res) => {
  try {
    const data = await fetchHiscores(req.params.username);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// TempleOSRS collection log. 404 if the player hasn't synced.
app.get('/api/collectionlog/:username', async (req, res) => {
  try {
    const data = await fetchCollectionLog(req.params.username);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// 24h risers/fallers. Enums are whitelisted; empty maxPrice means no cap.
app.get('/api/ge/movers', async (req, res) => {
  try {
    const minVolume = num(req.query.minVolume, 500);
    const minPrice = num(req.query.minPrice, 50);
    const maxPrice = req.query.maxPrice !== undefined && req.query.maxPrice !== ''
      ? num(req.query.maxPrice, Infinity)
      : Infinity;
    const minMargin = num(req.query.minMargin, 0);
    const minRoi = num(req.query.minRoi, 0);
    const hideStale = req.query.hideStale === '1' || req.query.hideStale === 'true';
    const membersOnly = ['all', 'members', 'f2p'].includes(req.query.membersOnly)
      ? req.query.membersOnly
      : 'all';
    const sort = ['pctChange', 'volume', 'price', 'marginAfterTax', 'profitPerLimit'].includes(req.query.sort)
      ? req.query.sort
      : 'pctChange';
    const limit = Math.min(num(req.query.limit, 25), 50);
    const data = await getMovers({
      minVolume, minPrice, maxPrice, minMargin, minRoi, hideStale, membersOnly, sort, limit
    });
    res.json(data);
  } catch (err) {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// Item detail. Unknown range values fall back to 1w via normalizeRange.
app.get('/api/ge/item/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid item id' });
    }
    const range = normalizeRange(req.query.range);
    const data = await getItemDetail(id, range);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// Item name search. Scores all mapping matches, then returns the top 25.
app.get('/api/ge/search', async (req, res) => {
  try {
    const results = await searchItems(req.query.q ?? '');
    res.json(results);
  } catch (err) {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// Flip Helper scanner. `ids` bypasses filters (watchlist / GE deep-link).
app.get('/api/ge/flips', async (req, res) => {
  try {
    const minVolume = num(req.query.minVolume, 0);
    const minPrice = num(req.query.minPrice, 0);
    const maxPrice = req.query.maxPrice !== undefined && req.query.maxPrice !== ''
      ? num(req.query.maxPrice, Infinity)
      : Infinity;
    const minMargin = num(req.query.minMargin, 0);
    const minRoi = num(req.query.minRoi, 0);
    const maxAgeMinutes = req.query.maxAgeMinutes !== undefined && req.query.maxAgeMinutes !== ''
      ? num(req.query.maxAgeMinutes, Infinity)
      : Infinity;
    const membersOnly = ['all', 'members', 'f2p'].includes(req.query.membersOnly)
      ? req.query.membersOnly
      : 'all';
    const bankroll = req.query.bankroll !== undefined && req.query.bankroll !== ''
      ? num(req.query.bankroll, null)
      : null;
    const sort = ['profitPerLimit', 'profit', 'roi', 'volume', 'realisticProfit', 'margin'].includes(req.query.sort)
      ? req.query.sort
      : 'profitPerLimit';
    const limit = Math.min(num(req.query.limit, 50), 200);
    const ids = req.query.ids
      ? String(req.query.ids).split(',').map(Number).filter(Number.isInteger)
      : null;
    const maxCapital = req.query.maxCapital !== undefined && req.query.maxCapital !== ''
      ? num(req.query.maxCapital, null)
      : null;
    const data = await getFlipCandidates({
      minVolume, minPrice, maxPrice, minMargin, minRoi, maxAgeMinutes,
      membersOnly, bankroll, sort, limit, ids, maxCapital
    });
    res.json(data);
  } catch (err) {
    res.status(err.statusCode ?? 500).json({ error: err.message });
  }
});

// Non-internal IPv4 addresses so a phone on the same LAN can open the app.
function lanUrls(port) {
  const urls = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal) urls.push(`http://${a.address}:${port}`);
    }
  }
  return urls;
}

// 0.0.0.0 so it's reachable on LAN/phone, not just localhost.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`OSRS Tracker running at http://localhost:${PORT}`);
  for (const url of lanUrls(PORT)) {
    console.log(`Phone on LAN: ${url}`);
  }
});
