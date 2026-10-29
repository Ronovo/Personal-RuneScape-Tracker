// The shapes of the JSON this app's own /api/* endpoints return.
//
// The sync and character response types live in src/shared/api.ts, and the GE and Flip shapes in
// src/shared/types.ts; both are re-exported here.

import type {
  MembersFilter, PriceRange, Confidence, SortDir, FlipSort, FlipItem, GeView, TimeseriesPoint, SearchResult,
  MoverItem, MoversResult, ItemDetail, FlipsResult,
} from '../shared/types.js';
import { FLIP_SORTS } from '../shared/types.js';

export type {
  MembersFilter, PriceRange, Confidence, SortDir, FlipSort, FlipItem, GeView, TimeseriesPoint, SearchResult,
  MoverItem, MoversResult, ItemDetail, FlipsResult,
};
export { FLIP_SORTS };

export type {
  SkillEntry, ScoredEntry, HiscoresData,
  QuestState, QuestKind, QuestWithMeta, QuestSummary, QuestProgressData,
  CollectionItem, CollectionCategory, CollectionGroup, CollectionLogData,
  DiaryTier, DiaryTierProgress, DiaryAreaProgress, DiarySummary, DiaryProgressData,
  CombatAchievementTaskView, CombatAchievementGroup, CombatAchievementSummary, CombatAchievementData,
  CompletedTaskWithMeta, TaskFilterOptions, LeaguesTasksData,
  ApiErrorBody,
} from '../shared/api.js';
