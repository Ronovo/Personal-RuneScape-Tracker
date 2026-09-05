import path from 'path';
import { fileURLToPath } from 'url';
import type { Request } from 'express';
import { atomicWriteFile } from './atomicWrite.js';
import { requireBearerToken } from './auth.js';
import { httpError } from './errors.js';
import { storagePathFor, readJsonOrDefault } from './jsonStore.js';

export interface CompletedTaskRecord {
  taskId: string;
  completedAt: string;
  source?: 'MANUAL' | 'AUTO';
}

export type { QuestState, DiaryTier } from '../shared/api.js';
import type { QuestState, DiaryTier } from '../shared/api.js';

export interface QuestProgress {
  id: number;
  name: string;
  state: QuestState;
}

// Obtained slots carry count 1: the plugin dump lists unique items, not stack size.
export interface CollectionLogItem {
  id: number;
  name: string;
  count: number;
}

export interface CollectionLogCategory {
  key: string;
  name: string;
  items: CollectionLogItem[];
}

export interface CollectionLogGroup {
  group: string;
  categories: CollectionLogCategory[];
}

export interface CollectionLogSnapshot {
  itemsObtained: number;
  itemsAvailable: number;
  groups: CollectionLogGroup[];
}

export interface DiaryProgress {
  area: string;
  tier: DiaryTier;
  complete: boolean;
}

export interface CombatAchievementTask {
  task: string;
  complete: boolean;
}

export interface CombatAchievementSnapshot {
  points: number;
  tasks: CombatAchievementTask[];
}

// One file per player holds every section the plugin can send. Sections are
// optional because each sync only carries what the client could read at the
// time (collection log needs the in-game interface open), and because files
// written before a section existed still have to load.
export interface LeaguesSyncPayload {
  username: string;
  syncedAt: string;
  completedTasks?: CompletedTaskRecord[];
  quests?: QuestProgress[];
  collectionLog?: CollectionLogSnapshot;
  achievementDiary?: DiaryProgress[];
  combatAchievements?: CombatAchievementSnapshot;
}

/** One writable slice of {@link LeaguesSyncPayload}; each POST /api/sync/* route updates exactly one. */
export type SyncSection =
  | 'completedTasks'
  | 'quests'
  | 'collectionLog'
  | 'achievementDiary'
  | 'combatAchievements';

const SECTION_KEYS: SyncSection[] = [
  'completedTasks',
  'quests',
  'collectionLog',
  'achievementDiary',
  'combatAchievements',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_DIR = process.env.SYNC_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'sync');

const USERNAME_RE = /^[a-z0-9 _-]{1,20}$/;
const NBSP = /\u00A0/g;

/** One in-flight acceptLeaguesSync per player so concurrent POSTs cannot lose sections. */
const syncChains = new Map<string, Promise<unknown>>();

export function storageKey(username: string): string {
  const key = username.replace(NBSP, ' ').trim().toLowerCase();
  if (!USERNAME_RE.test(key)) {
    throw httpError('Invalid username', 400);
  }
  return key;
}

// Chain per-user; swallow prior rejection so one failed sync does not block the next.
function enqueueSync<T>(username: string, work: () => Promise<T>): Promise<T> {
  const key = storageKey(username);
  const prev = syncChains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(work);
  syncChains.set(key, next);
  return next.finally(() => {
    if (syncChains.get(key) === next) {
      syncChains.delete(key);
    }
  });
}

/**
 * When a request explicitly sends an empty array for a section, treat it as
 * "nothing to update" if stored data already exists -- the plugin sends
 * completedTasks: [] when its local store is empty after a reinstall, which
 * must not wipe server-side history. Omitted sections still fall through
 * to stored via undefined.
 */
function mergeArraySection<T>(sent: T[] | undefined, stored: T[] | undefined): T[] | undefined {
  if (sent === undefined) {
    return stored;
  }
  if (sent.length === 0 && stored !== undefined && stored.length > 0) {
    return stored;
  }
  return sent;
}

function storagePath(username: string): string {
  return storagePathFor(SYNC_DIR, storageKey(username));
}

export { requireBearerToken, requirePlayerDataAuth } from './auth.js';

/** Scoped tokens are limited to their claimed RSNs; wildcard tokens honour SYNC_ALLOWED_USERS. */
export function assertAllowedUsername(req: Request, username: string): void {
  const key = storageKey(username);

  if (req.auth?.scope === 'user') {
    const rsns = req.auth.rsns ?? [];
    if (!rsns.includes(key)) {
      throw httpError('Forbidden — claim this RSN on your account first', 403);
    }
    return;
  }

  const raw = process.env.SYNC_ALLOWED_USERS?.trim();
  if (!raw) {
    return;
  }
  const allowed = new Set(
    raw
      .split(',')
      .map((s) => s.replace(NBSP, ' ').trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowed.has(key)) {
    throw httpError('Forbidden', 403);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCompletedTaskRecord(value: unknown): value is CompletedTaskRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.taskId) &&
    typeof record.completedAt === 'string' &&
    (record.source === undefined || record.source === 'MANUAL' || record.source === 'AUTO')
  );
}

const QUEST_STATES: QuestState[] = ['NOT_STARTED', 'IN_PROGRESS', 'FINISHED'];

// RuneLite's Quest enum has carried placeholder entries in the past; they'd
// only ever render as noise on the quests tab.
function isRealQuest(quest: QuestProgress): boolean {
  return quest.id >= 0 && !quest.name.startsWith('Fake');
}

function parseQuests(value: unknown): QuestProgress[] {
  if (!Array.isArray(value)) {
    throw httpError('Invalid quests', 400);
  }

  return value
    .map((entry): QuestProgress => {
      if (!entry || typeof entry !== 'object') {
        throw httpError('Invalid quests entry', 400);
      }

      const quest = entry as Record<string, unknown>;
      if (typeof quest.id !== 'number' || !Number.isFinite(quest.id)) {
        throw httpError('Invalid quest id', 400);
      }
      if (!isNonEmptyString(quest.name)) {
        throw httpError('Invalid quest name', 400);
      }
      if (!QUEST_STATES.includes(quest.state as QuestState)) {
        throw httpError('Invalid quest state', 400);
      }

      return { id: quest.id, name: quest.name.trim(), state: quest.state as QuestState };
    })
    .filter(isRealQuest);
}

function parseCollectionLogItems(value: unknown): CollectionLogItem[] {
  if (!Array.isArray(value)) {
    throw httpError('Invalid collectionLog items', 400);
  }

  return value.map((entry): CollectionLogItem => {
    if (!entry || typeof entry !== 'object') {
      throw httpError('Invalid collectionLog item', 400);
    }

    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'number' || !Number.isFinite(item.id)) {
      throw httpError('Invalid collectionLog item id', 400);
    }
    if (!isNonEmptyString(item.name)) {
      throw httpError('Invalid collectionLog item name', 400);
    }
    if (typeof item.count !== 'number' || !Number.isFinite(item.count)) {
      throw httpError('Invalid collectionLog item count', 400);
    }

    return { id: item.id, name: item.name.trim(), count: item.count };
  });
}

function parseCollectionLog(value: unknown): CollectionLogSnapshot {
  if (!value || typeof value !== 'object') {
    throw httpError('Invalid collectionLog', 400);
  }

  const snapshot = value as Record<string, unknown>;
  if (!Array.isArray(snapshot.groups)) {
    throw httpError('Invalid collectionLog groups', 400);
  }

  const groups = snapshot.groups.map((entry): CollectionLogGroup => {
    if (!entry || typeof entry !== 'object') {
      throw httpError('Invalid collectionLog group', 400);
    }

    const group = entry as Record<string, unknown>;
    if (!isNonEmptyString(group.group)) {
      throw httpError('Invalid collectionLog group name', 400);
    }
    if (!Array.isArray(group.categories)) {
      throw httpError('Invalid collectionLog categories', 400);
    }

    return {
      group: group.group.trim(),
      categories: group.categories.map((categoryEntry): CollectionLogCategory => {
        if (!categoryEntry || typeof categoryEntry !== 'object') {
          throw httpError('Invalid collectionLog category', 400);
        }

        const category = categoryEntry as Record<string, unknown>;
        if (!isNonEmptyString(category.key) || !isNonEmptyString(category.name)) {
          throw httpError('Invalid collectionLog category name', 400);
        }

        return {
          key: category.key.trim(),
          name: category.name.trim(),
          items: parseCollectionLogItems(category.items),
        };
      }),
    };
  });

  const items = groups.flatMap((g) => g.categories.flatMap((c) => c.items));
  return {
    itemsObtained:
      typeof snapshot.itemsObtained === 'number'
        ? snapshot.itemsObtained
        : items.filter((i) => i.count > 0).length,
    itemsAvailable: typeof snapshot.itemsAvailable === 'number' ? snapshot.itemsAvailable : items.length,
    groups,
  };
}

const DIARY_TIERS: DiaryTier[] = ['EASY', 'MEDIUM', 'HARD', 'ELITE'];

function parseAchievementDiary(value: unknown): DiaryProgress[] {
  if (!Array.isArray(value)) {
    throw httpError('Invalid achievementDiary', 400);
  }

  return value.map((entry): DiaryProgress => {
    if (!entry || typeof entry !== 'object') {
      throw httpError('Invalid achievementDiary entry', 400);
    }

    const diary = entry as Record<string, unknown>;
    if (!isNonEmptyString(diary.area)) {
      throw httpError('Invalid achievementDiary area', 400);
    }
    if (!DIARY_TIERS.includes(diary.tier as DiaryTier)) {
      throw httpError('Invalid achievementDiary tier', 400);
    }
    if (typeof diary.complete !== 'boolean') {
      throw httpError('Invalid achievementDiary complete flag', 400);
    }

    return {
      area: diary.area.trim(),
      tier: diary.tier as DiaryTier,
      complete: diary.complete,
    };
  });
}

function parseCombatAchievements(value: unknown): CombatAchievementSnapshot {
  if (!value || typeof value !== 'object') {
    throw httpError('Invalid combatAchievements', 400);
  }

  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.points !== 'number' || !Number.isFinite(snapshot.points)) {
    throw httpError('Invalid combatAchievements points', 400);
  }
  if (!Array.isArray(snapshot.tasks)) {
    throw httpError('Invalid combatAchievements tasks', 400);
  }

  const tasks = snapshot.tasks.map((entry): CombatAchievementTask => {
    if (!entry || typeof entry !== 'object') {
      throw httpError('Invalid combatAchievements task entry', 400);
    }

    const task = entry as Record<string, unknown>;
    if (!isNonEmptyString(task.task)) {
      throw httpError('Invalid combatAchievements task id', 400);
    }
    if (typeof task.complete !== 'boolean') {
      throw httpError('Invalid combatAchievements task complete flag', 400);
    }

    return { task: task.task.trim(), complete: task.complete };
  });

  return { points: snapshot.points, tasks };
}

export function parseLeaguesSyncPayload(body: unknown): LeaguesSyncPayload {
  if (!body || typeof body !== 'object') {
    throw httpError('Invalid JSON body', 400);
  }

  const payload = body as Record<string, unknown>;
  if (!isNonEmptyString(payload.username)) {
    throw httpError('Missing or invalid username', 400);
  }

  const parsed: LeaguesSyncPayload = {
    username: storageKey(String(payload.username)),
    syncedAt: typeof payload.syncedAt === 'string' ? payload.syncedAt : '',
  };

  if (payload.completedTasks !== undefined) {
    parsed.completedTasks = parseCompletedTasks(payload.completedTasks);
  }
  if (payload.quests !== undefined) {
    parsed.quests = parseQuests(payload.quests);
  }
  if (payload.collectionLog !== undefined) {
    parsed.collectionLog = parseCollectionLog(payload.collectionLog);
  }
  if (payload.achievementDiary !== undefined) {
    parsed.achievementDiary = parseAchievementDiary(payload.achievementDiary);
  }
  if (payload.combatAchievements !== undefined) {
    parsed.combatAchievements = parseCombatAchievements(payload.combatAchievements);
  }

  return parsed;
}

function parseCompletedTasks(value: unknown): CompletedTaskRecord[] {
  if (!Array.isArray(value)) {
    throw httpError('Invalid completedTasks', 400);
  }
  for (const record of value) {
    if (!isCompletedTaskRecord(record)) {
      throw httpError('Invalid completedTasks entry', 400);
    }
  }
  return value as CompletedTaskRecord[];
}

/** Parses username/syncedAt plus at most one section; rejects any other section key. */
export function parseSectionSyncPayload(body: unknown, section: SyncSection): LeaguesSyncPayload {
  if (!body || typeof body !== 'object') {
    throw httpError('Invalid JSON body', 400);
  }

  const payload = body as Record<string, unknown>;
  if (!isNonEmptyString(payload.username)) {
    throw httpError('Missing or invalid username', 400);
  }

  for (const key of SECTION_KEYS) {
    if (key !== section && payload[key] !== undefined) {
      throw httpError(`Unexpected field: ${key}`, 400);
    }
  }

  const parsed: LeaguesSyncPayload = {
    username: storageKey(String(payload.username)),
    syncedAt: typeof payload.syncedAt === 'string' ? payload.syncedAt : '',
  };

  if (payload[section] === undefined) {
    return parsed;
  }

  switch (section) {
    case 'completedTasks':
      parsed.completedTasks = parseCompletedTasks(payload.completedTasks);
      break;
    case 'quests':
      parsed.quests = parseQuests(payload.quests);
      break;
    case 'collectionLog':
      parsed.collectionLog = parseCollectionLog(payload.collectionLog);
      break;
    case 'achievementDiary':
      parsed.achievementDiary = parseAchievementDiary(payload.achievementDiary);
      break;
    case 'combatAchievements':
      parsed.combatAchievements = parseCombatAchievements(payload.combatAchievements);
      break;
  }

  return parsed;
}

function mergeSectionIntoStored(
  section: SyncSection,
  payload: LeaguesSyncPayload,
  stored: LeaguesSyncPayload | null
): LeaguesSyncPayload {
  const merged: LeaguesSyncPayload = {
    username: payload.username,
    syncedAt: payload.syncedAt || stored?.syncedAt || '',
    completedTasks: stored?.completedTasks,
    quests: stored?.quests,
    collectionLog: stored?.collectionLog,
    achievementDiary: stored?.achievementDiary,
    combatAchievements: stored?.combatAchievements,
  };

  switch (section) {
    case 'completedTasks':
      merged.completedTasks = mergeArraySection(payload.completedTasks, stored?.completedTasks);
      break;
    case 'quests':
      merged.quests = mergeArraySection(payload.quests, stored?.quests);
      break;
    case 'collectionLog':
      merged.collectionLog = payload.collectionLog ?? stored?.collectionLog;
      break;
    case 'achievementDiary':
      merged.achievementDiary = mergeArraySection(payload.achievementDiary, stored?.achievementDiary);
      break;
    case 'combatAchievements':
      merged.combatAchievements = payload.combatAchievements ?? stored?.combatAchievements;
      break;
  }

  return merged;
}

export async function saveLeaguesSync(payload: LeaguesSyncPayload): Promise<void> {
  await atomicWriteFile(storagePath(payload.username), JSON.stringify(payload, null, 2));
}

export async function loadLeaguesSync(username: string): Promise<LeaguesSyncPayload | null> {
  const raw = await readJsonOrDefault<unknown>(storagePath(username), null);
  return raw === null ? null : parseLeaguesSyncPayload(raw);
}

async function bindJwtSyncIdentity(req: Request, username: string): Promise<void> {
  if (req.auth?.scope !== 'user' || !req.auth.userId) return;
  const { bindJagexAccountForSync, parseAccountHash } = await import('./users.js');
  const hash = parseAccountHash(
    req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).accountHash : undefined,
  );
  const user = await bindJagexAccountForSync(req.auth.userId, username, hash);
  req.auth.rsns = [...user.rsns];
}

/** Validates and stores the snapshot. */
export async function acceptLeaguesSync(req: Request): Promise<LeaguesSyncPayload> {
  await requireBearerToken(req);
  const payload = parseLeaguesSyncPayload(req.body);
  await bindJwtSyncIdentity(req, payload.username);
  assertAllowedUsername(req, payload.username);

  return enqueueSync(payload.username, async () => {
    // A sync that omits a section (the plugin client only sends what it was
    // asked to sync, e.g. a quests-only or collection-log-only click) must
    // not discard whatever is already stored for the sections it left out --
    // and, symmetrically, must not manufacture a value for a section that was
    // never sent and never stored either. All five sections behave the same:
    // present only if this request or a prior stored sync actually had it.
    const stored = await loadLeaguesSync(payload.username);
    const merged = {
      ...payload,
      completedTasks: mergeArraySection(payload.completedTasks, stored?.completedTasks),
      quests: mergeArraySection(payload.quests, stored?.quests),
      collectionLog: payload.collectionLog ?? stored?.collectionLog,
      achievementDiary: mergeArraySection(payload.achievementDiary, stored?.achievementDiary),
      combatAchievements: payload.combatAchievements ?? stored?.combatAchievements,
    };

    await saveLeaguesSync(merged);
    return merged;
  });
}

/** Validates and stores one section only; other stored sections are preserved. */
export async function acceptSectionSync(req: Request, section: SyncSection): Promise<LeaguesSyncPayload> {
  await requireBearerToken(req);
  const payload = parseSectionSyncPayload(req.body, section);
  await bindJwtSyncIdentity(req, payload.username);
  assertAllowedUsername(req, payload.username);

  return enqueueSync(payload.username, async () => {
    const stored = await loadLeaguesSync(payload.username);
    const merged = mergeSectionIntoStored(section, payload, stored);
    await saveLeaguesSync(merged);
    return merged;
  });
}
