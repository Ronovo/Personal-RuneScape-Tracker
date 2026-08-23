import express from 'express';
import type { Request, Response } from 'express';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchHiscores } from './lib/hiscores.js';
import { getMovers, searchItems, getItemDetail, getFlipCandidates, normalizeRange } from './lib/prices.js';
import { fetchCollectionLog } from './lib/collectionlog.js';
import { errorStatus, errorMessage } from './lib/errors.js';
import { FLIP_SORTS } from './lib/types.js';
import type { MembersFilter, MoversSort, FlipSort, SortDir, GeView } from './lib/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4123;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

// Query params come in as strings; NaN should fall back rather than leak into filters.
function num<T>(value: unknown, fallback: T): number | T {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const MEMBERS_FILTERS: MembersFilter[] = ['all', 'members', 'f2p'];
const MOVERS_SORTS: MoversSort[] = ['pctChange', 'volume', 'price', 'marginAfterTax', 'profitPerLimit'];
const GE_VIEWS: GeView[] = ['risers', 'fallers', 'penny', 'random', 'spread', 'staircase'];
const PAGE_SIZES = [5, 10, 25, 50];

// Express query strings are untyped; unknown values fall back to 'all'.
function membersFilter(value: unknown): MembersFilter {
  return MEMBERS_FILTERS.includes(value as MembersFilter) ? (value as MembersFilter) : 'all';
}

// Jagex hiscores lookup (CSV index_lite.ws).
app.get('/api/hiscores/:username', async (req: Request, res: Response) => {
  try {
    const data = await fetchHiscores(String(req.params.username));
    res.json(data);
  } catch (err) {
    res.status(errorStatus(err)).json({ error: errorMessage(err) });
  }
});

// TempleOSRS collection log. 404 if the player hasn't synced.
app.get('/api/collectionlog/:username', async (req: Request, res: Response) => {
  try {
    const data = await fetchCollectionLog(String(req.params.username));
    res.json(data);
  } catch (err) {
    res.status(errorStatus(err)).json({ error: errorMessage(err) });
  }
});

// 24h risers/fallers. Enums are whitelisted; empty maxPrice means no cap.
app.get('/api/ge/movers', async (req: Request, res: Response) => {
  try {
    const minVolume = num(req.query.minVolume, 500);
    const minPrice = num(req.query.minPrice, 50);
    const maxPrice = req.query.maxPrice !== undefined && req.query.maxPrice !== ''
      ? num(req.query.maxPrice, Infinity)
      : Infinity;
    const minMargin = num(req.query.minMargin, 0);
    const minRoi = num(req.query.minRoi, 0);
    const hideStale = req.query.hideStale === '1' || req.query.hideStale === 'true';
    const membersOnly = membersFilter(req.query.membersOnly);
    const sort = MOVERS_SORTS.includes(req.query.sort as MoversSort) ? (req.query.sort as MoversSort) : 'pctChange';
    const limit = Math.min(num(req.query.limit, 25), 50);
    const view = GE_VIEWS.includes(req.query.view as GeView) ? (req.query.view as GeView) : 'risers';
    const seed = typeof req.query.seed === 'string' ? req.query.seed.slice(0, 64) : '';
    const data = await getMovers({
      minVolume, minPrice, maxPrice, minMargin, minRoi, hideStale, membersOnly, sort, limit, view, seed
    });
    res.json(data);
  } catch (err) {
    res.status(errorStatus(err)).json({ error: errorMessage(err) });
  }
});

// Item detail. Unknown range values fall back to 1w via normalizeRange.
app.get('/api/ge/item/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid item id' });
      return;
    }
    const range = normalizeRange(req.query.range);
    const data = await getItemDetail(id, range);
    res.json(data);
  } catch (err) {
    res.status(errorStatus(err)).json({ error: errorMessage(err) });
  }
});

// Item name search. Scores all mapping matches, then returns the top 25.
app.get('/api/ge/search', async (req: Request, res: Response) => {
  try {
    const results = await searchItems(String(req.query.q ?? ''));
    res.json(results);
  } catch (err) {
    res.status(errorStatus(err)).json({ error: errorMessage(err) });
  }
});

// Flip Helper scanner. `ids` bypasses filters (watchlist / GE deep-link).
app.get('/api/ge/flips', async (req: Request, res: Response) => {
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
    const membersOnly = membersFilter(req.query.membersOnly);
    const bankroll = req.query.bankroll !== undefined && req.query.bankroll !== ''
      ? num(req.query.bankroll, null)
      : null;
    const sort = FLIP_SORTS.includes(req.query.sort as FlipSort) ? (req.query.sort as FlipSort) : 'profitPerLimit';
    const sortDir: SortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
    const pageSizeRaw = num(req.query.pageSize, 50);
    const pageSize = PAGE_SIZES.includes(pageSizeRaw) ? pageSizeRaw : 50;
    const page = Math.max(1, num(req.query.page, 1));
    const ids = req.query.ids
      ? String(req.query.ids).split(',').map(Number).filter(Number.isInteger)
      : null;
    const maxCapital = req.query.maxCapital !== undefined && req.query.maxCapital !== ''
      ? num(req.query.maxCapital, null)
      : null;
    const name = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name : undefined;
    const data = await getFlipCandidates({
      minVolume, minPrice, maxPrice, minMargin, minRoi, maxAgeMinutes,
      membersOnly, bankroll, sort, sortDir, page, pageSize, ids, maxCapital, name
    });
    res.json(data);
  } catch (err) {
    res.status(errorStatus(err)).json({ error: errorMessage(err) });
  }
});

// Non-internal IPv4 addresses so a phone on the same LAN can open the app.
function lanUrls(port: number | string): string[] {
  const urls: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}`);
    }
  }
  return urls;
}

// 0.0.0.0 so it's reachable on LAN/phone, not just localhost.
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`OSRS Tracker running at http://localhost:${PORT}`);
  for (const url of lanUrls(PORT)) {
    console.log(`Phone on LAN: ${url}`);
  }
});
