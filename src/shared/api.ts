// The shapes the /api/* routes actually return, shared by the code that builds
// them and the code that renders them.
//
// These used to be written twice: once as local interfaces in src/lib/*.ts and
// again by hand in src/client/types.ts, on the reasoning that the browser build
// must not depend on server source. It doesn't have to - src/shared is compiled
// into both builds, which is where the prices types already lived. The sync
// types never made the move, and had started to drift: `CompletedTaskRecord`
// named two different shapes depending on which side you were on (the raw sync
// record server-side, the metadata-decorated row client-side), and one payload
// answered to both `MoversResult` and `MoversResponse`.
//
// A field renamed here is now a compile error on both sides instead of an
// `undefined` at runtime.

// ---- Hiscores (Jagex) ----

export interface SkillEntry {
  name: string;
  rank: number | null;
  level: number;
  xp: number;
}

export interface ScoredEntry {
  name: string;
  rank: number | null;
  score: number;
}

export interface HiscoresData {
  username: string;
  combatLevel: number;
  totalLevel: number;
  totalXp: number;
  skills: SkillEntry[];
  bosses: ScoredEntry[];
  minigames: ScoredEntry[];
  others: ScoredEntry[];
}

// ---- Plugin-synced vocabulary ----
// The plugin forwards RuneLite's own enums verbatim; both sides check against
// these, so they can't live on one side only.

export type QuestState = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED';
export type QuestKind = 'quest' | 'miniquest';
export type DiaryTier = 'EASY' | 'MEDIUM' | 'HARD' | 'ELITE';

// ---- Collection log ----

export interface CollectionItem {
  name: string;
  count: number;
  icon: string;
}

export interface CollectionCategory {
  key: string;
  name: string;
  obtained: number;
  total: number;
  items: CollectionItem[];
}

export interface CollectionGroup {
  group: string;
  categories: CollectionCategory[];
}

export interface CollectionLogData {
  username: string;
  syncedAt: string;
  itemsObtained: number;
  itemsAvailable: number;
  categoriesFinished: number;
  categoriesAvailable: number;
  groups: CollectionGroup[];
}

// ---- Quests ----
// kind/members aren't in RuneLite's enum - the server joins them on from the
// wiki scrape (src/lib/questmeta.ts) before serving.

export interface QuestWithMeta {
  id: number;
  name: string;
  state: QuestState;
  kind: QuestKind;
  members: boolean;
}

export interface QuestSummary {
  complete: number;
  inProgress: number;
  notStarted: number;
  miniquests: number;
  freeToPlay: number;
}

export interface QuestProgressData {
  username: string;
  syncedAt: string;
  summary: QuestSummary;
  quests: QuestWithMeta[];
}

// ---- Achievement diaries ----

export interface DiaryTierProgress {
  tier: DiaryTier;
  complete: boolean;
}

export interface DiaryAreaProgress {
  area: string;
  name: string;
  tiers: DiaryTierProgress[];
  complete: number;
  total: number;
}

export interface DiarySummary {
  complete: number;
  total: number;
}

export interface DiaryProgressData {
  username: string;
  syncedAt: string;
  summary: DiarySummary;
  areas: DiaryAreaProgress[];
}

// ---- Combat achievements ----

export interface CombatAchievementTaskView {
  task: string;
  name: string;
  group: string;
  groupKey: string;
  tier?: string;
  type?: string;
  complete: boolean;
}

export interface CombatAchievementGroup {
  key: string;
  name: string;
  complete: number;
  total: number;
}

export interface CombatAchievementSummary {
  points: number;
  complete: number;
  total: number;
}

export interface CombatAchievementData {
  username: string;
  syncedAt: string;
  summary: CombatAchievementSummary;
  groups: CombatAchievementGroup[];
  tasks: CombatAchievementTaskView[];
}

// ---- Leagues tasks ----
// region/difficulty/activityType come from the plugin's own task list, joined
// server-side onto the synced taskId (src/lib/leaguetaskmeta.ts). The sync
// itself only carries taskId/completedAt/source - see CompletedTaskRecord in
// src/lib/sync.ts, which is deliberately a different (and differently named)
// type from this one.

export interface CompletedTaskWithMeta {
  taskId: string;
  completedAt: string;
  source?: 'MANUAL' | 'AUTO';
  name: string;
  region: string;
  difficulty: string;
  activityType: string;
}

export interface TaskFilterOptions {
  regions: string[];
  difficulties: string[];
  activityTypes: string[];
}

export interface LeaguesTasksData {
  username: string;
  syncedAt: string;
  completedTasks: CompletedTaskWithMeta[];
  filters: TaskFilterOptions;
}

// ---- Errors ----
// Every /api error response is `{ error: string }`; see jsonErrors() in
// src/lib/app.ts.

export interface ApiErrorBody {
  error?: string;
}
