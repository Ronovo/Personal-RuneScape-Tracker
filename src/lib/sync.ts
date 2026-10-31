import type { Request } from 'express';
import { atomicWriteFile } from './atomicWrite.js';
import { requireBearerToken } from './auth.js';
import { httpError } from './errors.js';
import { dataDir, storagePathFor, readJsonOrDefault } from './jsonStore.js';
import { serialize } from './serialize.js';
import { foldName, storageKey } from './storageKey.js';
import { bindJagexAccountForSync, parseAccountHash } from './users.js';
import { DIARY_TIERS, QUEST_STATES } from '../shared/api.js';

export interface CompletedTaskRecord {
  taskId: string;
  completedAt: string;
  source?: 'MANUAL' | 'AUTO';
}

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
// time (collection log needs the in-game interface open).
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

const SYNC_DIR = dataDir('sync', 'SYNC_DATA_DIR');

/** One in-flight acceptLeaguesSync per player so concurrent POSTs cannot lose sections. */
const syncChains = new Map<string, Promise<unknown>>();

function storagePath(username: string): string {
  return storagePathFor(SYNC_DIR, storageKey(username));
}

/** Scoped tokens are limited to their claimed RSNs; wildcard tokens honour SYNC_ALLOWED_USERS. */
export function assertAllowedUsername(req: Request, username: string): void {
  const key = storageKey(username);

  if (req.auth?.scope === 'user') {
    const rsns = req.auth.rsns ?? [];
    if (!rsns.includes(key)) {
      throw httpError('Forbidden - claim this RSN on your account first', 403);
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
      .map(foldName)
      .filter(Boolean),
  );
  if (!allowed.has(key)) {
    throw httpError('Forbidden', 403);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}


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

function parseCompletedTasks(value: unknown): CompletedTaskRecord[] {
  if (!Array.isArray(value)) {
    throw httpError('Invalid completedTasks', 400);
  }
  return value.map((entry): CompletedTaskRecord => {
    const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (!isNonEmptyString(record.taskId) || typeof record.completedAt !== 'string'
      || (record.source !== undefined && record.source !== 'MANUAL' && record.source !== 'AUTO')) {
      throw httpError('Invalid completedTasks entry', 400);
    }
    return {
      taskId: record.taskId.trim(),
      completedAt: record.completedAt,
      ...(record.source ? { source: record.source } : {}),
    };
  });
}

/**
 * How each section is read and merged. A list section that arrives empty keeps what is stored: the plugin
 * sends completedTasks: [] when its local store is empty after a reinstall, which must not wipe server-side
 * history. A snapshot section replaces what is stored.
 */
const SECTIONS: { [K in SyncSection]: { parse: (value: unknown) => NonNullable<LeaguesSyncPayload[K]>; list: boolean } } = {
  completedTasks: { parse: parseCompletedTasks, list: true },
  quests: { parse: parseQuests, list: true },
  collectionLog: { parse: parseCollectionLog, list: false },
  achievementDiary: { parse: parseAchievementDiary, list: true },
  combatAchievements: { parse: parseCombatAchievements, list: false },
};

const SECTION_KEYS = Object.keys(SECTIONS) as SyncSection[];

function setSection<K extends SyncSection>(target: LeaguesSyncPayload, key: K, value: LeaguesSyncPayload[K]): void {
  target[key] = value;
}

function mergeSection<K extends SyncSection>(key: K, sent: LeaguesSyncPayload[K], stored: LeaguesSyncPayload[K]): LeaguesSyncPayload[K] {
  if (sent === undefined) {
    return stored;
  }
  if (SECTIONS[key].list && Array.isArray(sent) && sent.length === 0 && Array.isArray(stored) && stored.length > 0) {
    return stored;
  }
  return sent;
}

/** Parses username/syncedAt plus the given sections; rejects any other section key. */
export function parsePayload(body: unknown, sections: readonly SyncSection[] = SECTION_KEYS): LeaguesSyncPayload {
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

  for (const key of SECTION_KEYS) {
    if (payload[key] === undefined) {
      continue;
    }
    if (!sections.includes(key)) {
      throw httpError(`Unexpected field: ${key}`, 400);
    }
    setSection(parsed, key, SECTIONS[key].parse(payload[key]));
  }

  return parsed;
}

/**
 * A sync carries only what the plugin was asked to send, e.g. a quests-only click. A section it left out keeps
 * what is stored, and a section never sent nor stored stays absent.
 */
function mergeIntoStored(payload: LeaguesSyncPayload, stored: LeaguesSyncPayload | null): LeaguesSyncPayload {
  const merged: LeaguesSyncPayload = {
    username: payload.username,
    syncedAt: payload.syncedAt || stored?.syncedAt || '',
  };
  for (const key of SECTION_KEYS) {
    setSection(merged, key, mergeSection(key, payload[key], stored?.[key]));
  }
  return merged;
}

export async function saveLeaguesSync(payload: LeaguesSyncPayload): Promise<void> {
  await atomicWriteFile(storagePath(payload.username), JSON.stringify(payload, null, 2));
}

/**
 * The stored file, read leniently: a section that no longer parses (say RuneLite added a quest state) is
 * dropped with a warning instead of failing every read and every later sync for that player.
 */
export async function loadLeaguesSync(username: string): Promise<LeaguesSyncPayload | null> {
  const raw = await readJsonOrDefault<Record<string, unknown> | null>(storagePath(username), null);
  if (raw === null) {
    return null;
  }
  const stored: LeaguesSyncPayload = {
    username: storageKey(username),
    syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : '',
  };
  for (const key of SECTION_KEYS) {
    if (raw[key] === undefined) {
      continue;
    }
    try {
      setSection(stored, key, SECTIONS[key].parse(raw[key]));
    } catch (err) {
      /* c8 ignore next - the section parsers only throw Errors */
      console.warn(`[sync] dropped ${username}'s stored ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stored;
}

async function bindJwtSyncIdentity(req: Request, username: string): Promise<void> {
  if (req.auth?.scope !== 'user' || !req.auth.userId) return;
  const hash = parseAccountHash(
    /* c8 ignore next - parsePayload has already refused a body that is not an object */
    req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).accountHash : undefined,
  );
  const user = await bindJagexAccountForSync(req.auth.userId, username, hash);
  req.auth.rsns = [...user.rsns];
}

async function acceptSync(req: Request, sections: readonly SyncSection[]): Promise<LeaguesSyncPayload> {
  await requireBearerToken(req);
  const payload = parsePayload(req.body, sections);
  await bindJwtSyncIdentity(req, payload.username);
  assertAllowedUsername(req, payload.username);

  return serialize(syncChains, payload.username, async () => {
    const merged = mergeIntoStored(payload, await loadLeaguesSync(payload.username));
    await saveLeaguesSync(merged);
    return merged;
  });
}

/** Validates and stores the snapshot. */
export function acceptLeaguesSync(req: Request): Promise<LeaguesSyncPayload> {
  return acceptSync(req, SECTION_KEYS);
}

/** Validates and stores one section only; other stored sections are preserved. */
export function acceptSectionSync(req: Request, section: SyncSection): Promise<LeaguesSyncPayload> {
  return acceptSync(req, [section]);
}
