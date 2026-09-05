import express from 'express';
import type { Request, Response, NextFunction, Express } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchHiscores } from './hiscores.js';
import { getMovers, searchItems, getItemDetail, getFlipCandidates, normalizeRange } from './prices.js';
import { fetchCollectionLog } from './collectionlog.js';
import { acceptLeaguesSync, acceptSectionSync, requirePlayerDataAuth, assertAllowedUsername } from './sync.js';
import type { SyncSection } from './sync.js';
import { authLogin, authMe, authMintToken, authRegister, authStatus } from './authRoutes.js';
import { fetchQuestProgress } from './quests.js';
import { fetchDiaryProgress } from './diaries.js';
import { fetchCombatAchievements } from './combatachievements.js';
import { fetchLeaguesTasks } from './leaguetasks.js';
import { loadWatchlist, saveWatchlist } from './watchlist.js';
import { errorStatus, errorMessage, isHttpError } from './errors.js';
import { FLIP_SORTS } from './types.js';
import type { MembersFilter, MoversSort, SortDir, GeView } from './types.js';
import { securityHeaders } from './securityHeaders.js';
import { loadJsonAsset } from './jsonStore.js';
import { apiRateLimit, authRateLimit } from './rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// package.json sits two levels up from dist/lib at runtime and from src/lib in
// the tree, so the same relative path works either way.
const APP_VERSION: string = loadJsonAsset<{ version?: string }>(
  import.meta.url,
  path.join('..', '..', 'package.json'),
).version ?? 'unknown';

// Query params come in as strings; NaN should fall back rather than leak into filters.
function num<T>(value: unknown, fallback: T): number | T {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Same as num(), but treats an omitted or empty-string query param as "not
// provided" too, instead of coercing '' to NaN and falling back anyway - the
// distinction matters for callers who need to tell "absent" from "explicit 0".
function numOrFallback<T>(value: unknown, fallback: T): number | T {
  return value === undefined || value === '' ? fallback : num(value, fallback);
}

// Express query strings/enum params are untyped; anything not in the
// whitelist falls back to a known-good default.
function whitelisted<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

const MEMBERS_FILTERS: MembersFilter[] = ['all', 'members', 'f2p'];
const MOVERS_SORTS: MoversSort[] = ['pctChange', 'volume', 'price', 'marginAfterTax', 'profitPerLimit'];
const GE_VIEWS: GeView[] = ['risers', 'fallers', 'volume', 'random'];
const PAGE_SIZES = [5, 10, 25, 50];

function membersFilter(value: unknown): MembersFilter {
  return whitelisted(value, MEMBERS_FILTERS, 'all');
}

// Express hands back a string, an array of strings, or a nested object,
// depending on what the caller put in the query string. Only the first is a
// value here; String()-ing the others yields '[object Object]' or a joined
// list, which then gets searched for or parsed as if the caller meant it.
function queryString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Every route follows the same "run the handler, JSON-ify a thrown httpError"
// shape; this removes the identical try/catch each one used to repeat. The
// JSON-ifying itself lives in jsonErrors() below, so route rejections and
// errors thrown by middleware (a malformed body never reaches a handler) are
// shaped by one piece of code rather than two that can drift.
function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

// body-parser tags its own failures; without this they reach the client as
// whatever JSON.parse said, which is internal parser detail.
function bodyParserError(err: unknown): { status: number; message: string } | null {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') return { status: 400, message: 'Invalid JSON body' };
  if (type === 'entity.too.large') return { status: 413, message: 'Request body too large' };
  return null;
}

// The single place an error becomes a response. Registered last, so it also
// catches middleware that throws before any route runs - Express's own
// fallback would answer those with an HTML page carrying a stack trace.
// Exported so its branches can be tested directly: appending a throwing route
// to a built app would land after this handler and never reach it.
export function jsonErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const parseError = bodyParserError(err);
  if (parseError) {
    res.status(parseError.status).json({ error: parseError.message });
    return;
  }

  // Anything not tagged with httpError() is a crash: log it in full and tell
  // the client nothing, because its message is a filesystem path or a parser
  // internal. A tagged error carries a sentence written for the caller,
  // whatever its status - "Account auth is not enabled on this server" (501)
  // is the answer to the request, not a leak.
  if (!isHttpError(err)) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  const status = errorStatus(err);
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: errorMessage(err) });
}

async function playerDataAuth(req: Request, username: string): Promise<void> {
  await requirePlayerDataAuth(req);
  assertAllowedUsername(req, username);
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  // Only trust X-Forwarded-* when a proxy is actually in front of us - set
  // TRUST_PROXY=1 (hop count) or a preset like "loopback" for the documented
  // reverse-proxy deployment. Left unset, req.ip stays the socket address and
  // req.secure stays false, which is correct for a direct LAN host.
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.use(securityHeaders);
  app.use(express.json({ limit: '1mb' }));

  // Ahead of the rate limiter so uptime checks are never throttled. The
  // version answers the question you actually have after a rebuild: not "is
  // something up" but "is the thing I just built the thing that is up".
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: APP_VERSION });
  });

  app.use('/api', apiRateLimit());

  const authLimiter = authRateLimit();
  app.get('/api/auth/status', asyncHandler(authStatus));
  app.post('/api/auth/register', authLimiter, asyncHandler(authRegister));
  app.post('/api/auth/login', authLimiter, asyncHandler(authLogin));
  app.post('/api/auth/token', authLimiter, asyncHandler(authMintToken));
  app.get('/api/auth/me', asyncHandler(authMe));

  app.get('/api/hiscores/:username', asyncHandler(async (req, res) => {
    const data = await fetchHiscores(String(req.params.username));
    res.json(data);
  }));

  // Collection log, read from the Leagues Tasks plugin sync. 404 if the player hasn't synced.
  app.get('/api/collectionlog/:username', asyncHandler(async (req, res) => {
    const username = String(req.params.username);
    await playerDataAuth(req, username);
    const data = await fetchCollectionLog(username);
    res.json(data);
  }));

  // 24h risers/fallers. Enums are whitelisted; empty maxPrice means no cap.
  app.get('/api/ge/movers', asyncHandler(async (req, res) => {
    const minVolume = num(req.query.minVolume, 500);
    const minPrice = num(req.query.minPrice, 50);
    const maxPrice = numOrFallback(req.query.maxPrice, Infinity);
    const minMargin = num(req.query.minMargin, 0);
    const minRoi = num(req.query.minRoi, 0);
    const maxAgeMinutes = numOrFallback(req.query.maxAgeMinutes, Infinity);
    const hideStale = req.query.hideStale === '1' || req.query.hideStale === 'true';
    const membersOnly = membersFilter(req.query.membersOnly);
    const sort = whitelisted(req.query.sort, MOVERS_SORTS, 'pctChange');
    const sortDir: SortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
    // Clamped at both ends: `?limit=-1` used to reach .slice(0, -1), which
    // quietly returned the page minus its last row.
    const limit = clamp(num(req.query.limit, 25), 1, 50);
    const view = whitelisted(req.query.view, GE_VIEWS, 'risers');
    const seed = typeof req.query.seed === 'string' ? req.query.seed.slice(0, 64) : '';
    const data = await getMovers({
      minVolume, minPrice, maxPrice, minMargin, minRoi, maxAgeMinutes, hideStale, membersOnly, sort, sortDir, limit, view, seed
    });
    res.json(data);
  }));

  // Item detail. Unknown range values fall back to 1w via normalizeRange.
  app.get('/api/ge/item/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid item id' });
      return;
    }
    const data = await getItemDetail(id, normalizeRange(req.query.range));
    res.json(data);
  }));

  app.get('/api/ge/search', asyncHandler(async (req, res) => {
    const results = await searchItems(queryString(req.query.q));
    res.json(results);
  }));

  app.post('/api/sync/leagues', asyncHandler(async (req, res) => {
    await acceptLeaguesSync(req);
    res.status(200).json({ ok: true });
  }));

  const SECTION_ROUTES: { path: string; section: SyncSection }[] = [
    { path: '/api/sync/tasks', section: 'completedTasks' },
    { path: '/api/sync/quests', section: 'quests' },
    { path: '/api/sync/collectionlog', section: 'collectionLog' },
    { path: '/api/sync/diaries', section: 'achievementDiary' },
    { path: '/api/sync/combatachievements', section: 'combatAchievements' },
  ];
  for (const { path: routePath, section } of SECTION_ROUTES) {
    app.post(routePath, asyncHandler(async (req, res) => {
      await acceptSectionSync(req, section);
      res.status(200).json({ ok: true });
    }));
  }

  app.get('/api/quests/:username', asyncHandler(async (req, res) => {
    const username = String(req.params.username);
    await playerDataAuth(req, username);
    const data = await fetchQuestProgress(username);
    res.json(data);
  }));

  app.get('/api/diaries/:username', asyncHandler(async (req, res) => {
    const username = String(req.params.username);
    await playerDataAuth(req, username);
    const data = await fetchDiaryProgress(username);
    res.json(data);
  }));

  app.get('/api/combatachievements/:username', asyncHandler(async (req, res) => {
    const username = String(req.params.username);
    await playerDataAuth(req, username);
    const data = await fetchCombatAchievements(username);
    res.json(data);
  }));

  app.get('/api/leagues/:username', asyncHandler(async (req, res) => {
    const username = String(req.params.username);
    await playerDataAuth(req, username);
    const data = await fetchLeaguesTasks(username);
    res.json(data);
  }));

  // Flip Helper scanner. `ids` bypasses filters (watchlist / GE deep-link).
  app.get('/api/ge/flips', asyncHandler(async (req, res) => {
    const minVolume = num(req.query.minVolume, 0);
    const minPrice = num(req.query.minPrice, 0);
    const maxPrice = numOrFallback(req.query.maxPrice, Infinity);
    const minMargin = num(req.query.minMargin, 0);
    const minRoi = num(req.query.minRoi, 0);
    const minMarginVsAvg = num(req.query.minMarginVsAvg, 0);
    const maxAgeMinutes = numOrFallback(req.query.maxAgeMinutes, Infinity);
    const membersOnly = membersFilter(req.query.membersOnly);
    const bankroll = numOrFallback(req.query.bankroll, null);
    const sort = whitelisted(req.query.sort, FLIP_SORTS, 'profitPerLimit');
    const sortDir: SortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
    const pageSizeRaw = num(req.query.pageSize, 50);
    const pageSize = whitelisted(pageSizeRaw, PAGE_SIZES, 50);
    const page = Math.max(1, num(req.query.page, 1));
    const idsParam = queryString(req.query.ids);
    const ids = idsParam ? idsParam.split(',').map(Number).filter(Number.isInteger) : null;
    const maxCapital = numOrFallback(req.query.maxCapital, null);
    const name = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name : undefined;
    const data = await getFlipCandidates({
      minVolume, minPrice, maxPrice, minMargin, minRoi, minMarginVsAvg, maxAgeMinutes,
      membersOnly, bankroll, sort, sortDir, page, pageSize, ids, maxCapital, name
    });
    res.json(data);
  }));

  // Flip Helper watchlist, keyed by character name. Same bearer token as the
  // player GETs above: required once JWT_SECRET is set, open on a guest host.
  app.get('/api/watchlist/:username', asyncHandler(async (req, res) => {
    const username = String(req.params.username);
    await playerDataAuth(req, username);
    const itemIds = await loadWatchlist(username);
    res.json({ itemIds });
  }));

  app.put('/api/watchlist/:username', asyncHandler(async (req, res) => {
    const username = String(req.params.username);
    await playerDataAuth(req, username);
    const itemIds = await saveWatchlist(username, req.body?.itemIds);
    res.json({ itemIds });
  }));

  // Anything under /api that no route above matched is a client error, not a
  // static file. Without this it falls through to express.static, misses, and
  // Express answers with an HTML 404 - which the browser client reports as
  // "Server returned HTML instead of JSON. Stop the running tracker...".
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  app.use(jsonErrors);

  return app;
}
