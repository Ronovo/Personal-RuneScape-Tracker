// Collection log contents aren't exposed by any official Jagex API - the
// OSRS hiscores only give a single aggregate "Collections Logged" count.
// This uses TempleOSRS's public, keyless API instead, which players opt into
// via a RuneLite plugin that syncs their log.
// Verified live against https://templeosrs.com/api_doc.php
// (2026-08-19): a player who hasn't synced returns HTTP 200 with
// {"error":{"Code":402,...}}, which we surface as a friendly "no data" case
// rather than a server error.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { httpError } from './errors.js';
import { fetchWithUserAgent, cachedByKey } from './http.js';

const BASE = 'https://templeosrs.com/api/collection-log/player_collection_log.php';
const CACHE_TTL_MS = 60 * 1000;

interface RawCollectionItem {
  name: string;
  count: number;
}

interface CollectionItem extends RawCollectionItem {
  icon: string;
}

interface CollectionCategory {
  key: string;
  name: string;
  obtained: number;
  total: number;
  items: CollectionItem[];
}

interface CollectionGroup {
  group: string;
  categories: CollectionCategory[];
}

interface CollectionLogData {
  username: string;
  lastChecked: string | null;
  itemsObtained: number;
  itemsAvailable: number;
  categoriesFinished: number;
  categoriesAvailable: number;
  hiscoresRank: number | null;
  groups: CollectionGroup[];
}

interface TempleOsrsData {
  player_name_with_capitalization?: string;
  player?: string;
  last_checked: string | null;
  total_collections_finished: number;
  total_collections_available: number;
  total_categories_finished: number;
  total_categories_available: number;
  collections_hiscores_rank: number | null;
  items: Record<string, RawCollectionItem[]>;
}

interface TempleOsrsResponse {
  error?: unknown;
  data: TempleOsrsData;
}

interface ImageNameConversion {
  auto: Record<string, string>;
  manual: Record<string, string>;
}

const cache = new Map<string, { data: CollectionLogData; at: number }>();

// Overrides for items whose real wiki filename can't be derived from the
// TempleOSRS name by a simple rule.
// - "auto" was resolved automatically (custom casing, or stack/charge items
// with no bare filename). "manual" lists names still needing lookup -
// entries start blank ("") and are filled in by hand as they're found; a
// blank value is skipped and falls through to the raw name like normal.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { auto: AUTO_NAME_CONVERSION, manual: MANUAL_NAME_CONVERSION }: ImageNameConversion = JSON.parse(
  readFileSync(path.join(__dirname, 'image_name_conversion.json'), 'utf8')
).image_name_conversion;

// Order and grouping verified against category_parameters.php.
const CATEGORY_GROUPS: Record<string, string[]> = {
  Bosses: [
    'abyssal_sire', 'alchemical_hydra', 'amoxliatl', 'araxxor', 'barrows_chests',
    'brutus', 'bryophyta', 'callisto_and_artio', 'cerberus', 'chaos_elemental',
    'chaos_fanatic', 'commander_zilyana', 'corporeal_beast', 'crazy_archaeologist',
    'dagannoth_kings', 'deranged_archaeologist', 'doom_of_mokhaiotl', 'duke_sucellus',
    'the_fight_caves', 'fortis_colosseum', 'the_gauntlet', 'general_graardor',
    'giant_mole', 'grotesque_guardians', 'hespori', 'hueycoatl', 'the_inferno',
    'kalphite_queen', 'king_black_dragon', 'kraken', 'kree_arra', 'kril_tsutsaroth',
    'the_leviathan', 'the_mad_angel', 'maggot_king', 'moons_of_peril', 'nex',
    'the_nightmare', 'obor', 'phantom_muspah', 'royal_titans', 'sarachnis',
    'scorpia', 'scurrius', 'shellbane_gryphon', 'skotizo', 'tempoross',
    'thermonuclear_smoke_devil', 'vardorvis', 'venenatis_and_spindel',
    'vetion_and_calvarion', 'vorkath', 'the_whisperer', 'wintertodt', 'yama',
    'zalcano', 'zulrah'
  ],
  Raids: ['chambers_of_xeric', 'theatre_of_blood', 'tombs_of_amascut'],
  Clues: [
    'beginner_treasure_trails', 'easy_treasure_trails', 'medium_treasure_trails',
    'hard_treasure_trails', 'elite_treasure_trails', 'master_treasure_trails',
    'gilded', 'third_age', 'mimic', 'shared_treasure_trail_rewards', 'scroll_cases'
  ],
  Minigames: [
    'barbarian_assault', 'barracuda_trials', 'brimhaven_agility_arena', 'castle_wars',
    'fishing_trawler', 'giants_foundry', 'gnome_restaurant', 'guardians_of_the_rift',
    'hallowed_sepulchre', 'last_man_standing', 'magic_training_arena', 'mahogany_homes',
    'pest_control', 'mastering_mixology', 'rogues_den', 'shades_of_mortton', 'soul_wars',
    'temple_trekking', 'tithe_farm', 'trouble_brewing', 'vale_totems', 'volcanic_mine'
  ],
  Other: [
    'aerial_fishing', 'all_pets', 'boat_paints', 'camdozaal', 'champions_challenge',
    'chaos_druids', 'chompy_bird_hunting', 'colossal_wyrm_agility', 'creature_creation',
    'cyclopes', 'forestry', 'fossil_island_notes', 'gloughs_experiments', 'hunter_guild',
    'lost_schematics', 'monkey_backpacks', 'motherlode_mine', 'my_notes',
    'ocean_encounters', 'random_events', 'revenants', 'rooftop_agility',
    'sailing_miscellaneous', 'sea_treasures', 'shayzien_armour', 'shooting_stars',
    'skilling_pets', 'slayer', 'tormented_demons', 'tzhaar', 'miscellaneous'
  ]
};

const ALL_CATEGORIES = Object.values(CATEGORY_GROUPS).flat().join(',');

// Wiki/Temple display names that snake_case → Title Case gets wrong.
const SPECIAL_NAMES: Record<string, string> = {
  kree_arra: "Kree'Arra",
  kril_tsutsaroth: "K'ril Tsutsaroth",
  vetion_and_calvarion: "Vet'ion and Calvar'ion",
  tzhaar: 'TzHaar'
};

function iconUrl(itemName: string): string {
  const resolvedName = AUTO_NAME_CONVERSION[itemName] || MANUAL_NAME_CONVERSION[itemName] || itemName;
  return `https://oldschool.runescape.wiki/images/${encodeURIComponent(resolvedName.replace(/ /g, '_'))}.png`;
}

function prettify(key: string): string {
  if (SPECIAL_NAMES[key]) return SPECIAL_NAMES[key];
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function fetchCollectionLog(username: string): Promise<CollectionLogData> {
  const key = username.toLowerCase();
  return cachedByKey(cache, key, CACHE_TTL_MS, async () => {
    const url = `${BASE}?player=${encodeURIComponent(username)}&categories=${ALL_CATEGORIES}&includenames=1&includemissingitems=1`;
    const res = await fetchWithUserAgent(url);
    if (!res.ok) {
      throw httpError('Collection log lookup failed', 502);
    }

    const body = (await res.json()) as TempleOsrsResponse;
    if (body.error) {
      throw httpError(
        'No synced collection log found for this player (they may not use the TempleOSRS RuneLite plugin, or the name is misspelled)',
        404
      );
    }

    const d = body.data;
    const groups: CollectionGroup[] = Object.entries(CATEGORY_GROUPS).map(([group, keys]) => ({
      group,
      categories: keys.map((k): CollectionCategory => {
        const items: CollectionItem[] = (d.items[k] ?? []).map((i) => ({ ...i, icon: iconUrl(i.name) }));
        // Category progress counts obtained slots, not duplicate item quantities.
        return {
          key: k,
          name: prettify(k),
          obtained: items.filter((i) => i.count > 0).length,
          total: items.length,
          items
        };
      })
    }));

    return {
      username: d.player_name_with_capitalization || d.player || username,
      lastChecked: d.last_checked,
      itemsObtained: d.total_collections_finished,
      itemsAvailable: d.total_collections_available,
      categoriesFinished: d.total_categories_finished,
      categoriesAvailable: d.total_categories_available,
      hiscoresRank: d.collections_hiscores_rank,
      groups
    };
  });
}
