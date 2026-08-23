// Order below is verified directly against real hiscore data: fetched
// index_lite.ws for a live account, then cross-checked individual values
// (rank, score) against secure.runescape.com's own per-category personal
// pages (.../hiscorepersonal?user1=X&category_type=1&table=N) as of
// 2026-08-19. That confirmed CSV activity line index N (0-based, first
// activity line = index 0) holds the SAME data as category_type=1&table=N —
// i.e. table number equals CSV index directly, not table-1 as the table
// links alone would suggest. Index 0 has no known table= page (table=0 is
// invalid) and reliably comes back unranked/zero, so it's an unidentified
// legacy column that gets skipped rather than mis-attributed to a real
// activity. Table=91 ("Grid Points") also is NOT yet present in the CSV
// feed even though its category page exists, and Sailing genuinely is skill
// index 24 (verified: real accounts report nonzero Sailing XP there).

import { httpError } from './errors.js';
import { fetchWithUserAgent, cachedByKey } from './http.js';

interface SkillEntry {
  name: string;
  rank: number | null;
  level: number;
  xp: number;
}

interface ScoredEntry {
  name: string;
  rank: number | null;
  score: number;
}

interface HiscoresData {
  username: string;
  combatLevel: number;
  totalLevel: number;
  totalXp: number;
  skills: SkillEntry[];
  bosses: ScoredEntry[];
  minigames: ScoredEntry[];
  others: ScoredEntry[];
}

type ActivityCategory = 'unknown' | 'others' | 'minigames' | 'bosses';

interface ActivityOrderEntry {
  name: string | null;
  category: ActivityCategory;
}

const SKILLS = [
  'Overall', 'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer',
  'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking',
  'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving',
  'Slayer', 'Farming', 'Runecraft', 'Hunter', 'Construction', 'Sailing'
];

// Bosses, category_type=1 table 20-90, in exact live order.
const BOSSES = [
  'Abyssal Sire', 'Alchemical Hydra', 'Amoxliatl', 'Araxxor', 'Artio',
  'Barrows Chests', 'Brutus', 'Bryophyta', 'Callisto', "Calvar'ion",
  'Cerberus', 'Chambers of Xeric', 'Chambers of Xeric: Challenge Mode',
  'Chaos Elemental', 'Chaos Fanatic', 'Commander Zilyana', 'Corporeal Beast',
  'Crazy Archaeologist', 'Dagannoth Prime', 'Dagannoth Rex',
  'Dagannoth Supreme', 'Deranged Archaeologist', 'Doom of Mokhaiotl',
  'Duke Sucellus', 'General Graardor', 'Giant Mole', 'Grotesque Guardians',
  'Hespori', 'Kalphite Queen', 'King Black Dragon', 'Kraken', "Kree'Arra",
  "K'ril Tsutsaroth", 'Lunar Chests', 'Mad Angel', 'Maggot King', 'Mimic',
  'Nex', 'Nightmare', "Phosani's Nightmare", 'Obor', 'Phantom Muspah',
  'Sarachnis', 'Scorpia', 'Scurrius', 'Shellbane Gryphon', 'Skotizo',
  'Sol Heredit', 'Spindel', 'Tempoross', 'The Gauntlet',
  'The Corrupted Gauntlet', 'The Hueycoatl', 'The Leviathan',
  'The Royal Titans', 'The Whisperer', 'Theatre of Blood',
  'Theatre of Blood: Hard Mode', 'Thermonuclear Smoke Devil',
  'Tombs of Amascut', 'Tombs of Amascut: Expert Mode', 'TzKal-Zuk',
  'TzTok-Jad', 'Vardorvis', 'Venenatis', "Vet'ion", 'Vorkath', 'Wintertodt',
  'Yama', 'Zalcano', 'Zulrah'
];

// index_lite.ws activity line index 0 is an unidentified legacy column
// (verified: no valid category_type=1&table=0 page exists). Index 1 onward
// lines up exactly with category_type=1&table=1 onward.
const ACTIVITY_ORDER: ActivityOrderEntry[] = [
  { name: null, category: 'unknown' },
  { name: 'League Points', category: 'others' },
  { name: 'Deadman Points', category: 'others' },
  { name: 'Bounty Hunter - Hunter', category: 'minigames' },
  { name: 'Bounty Hunter - Rogue', category: 'minigames' },
  { name: 'Bounty Hunter (Legacy) - Hunter', category: 'minigames' },
  { name: 'Bounty Hunter (Legacy) - Rogue', category: 'minigames' },
  { name: 'Clue Scrolls (all)', category: 'others' },
  { name: 'Clue Scrolls (beginner)', category: 'others' },
  { name: 'Clue Scrolls (easy)', category: 'others' },
  { name: 'Clue Scrolls (medium)', category: 'others' },
  { name: 'Clue Scrolls (hard)', category: 'others' },
  { name: 'Clue Scrolls (elite)', category: 'others' },
  { name: 'Clue Scrolls (master)', category: 'others' },
  { name: 'LMS - Rank', category: 'minigames' },
  { name: 'PvP Arena - Rank', category: 'minigames' },
  { name: 'Soul Wars Zeal', category: 'minigames' },
  { name: 'Rifts closed', category: 'minigames' },
  { name: 'Colosseum Glory', category: 'minigames' },
  { name: 'Collections Logged', category: 'others' },
  ...BOSSES.map((name): ActivityOrderEntry => ({ name, category: 'bosses' }))
];

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { data: HiscoresData; at: number }>();

// Jagex formula — combat level is not in the CSV. Uses the max(melee, range, mage) branch.
// https://oldschool.runescape.wiki/w/Combat_level#Calculating_combat_level
function combatLevel(skills: SkillEntry[]): number {
  const lvl = (name: string) => skills.find((s) => s.name === name)?.level ?? 1;

  const base = 0.25 * (lvl('Defence') + lvl('Hitpoints') + Math.floor(lvl('Prayer') / 2));
  const melee = 0.325 * (lvl('Attack') + lvl('Strength'));
  const range = 0.325 * Math.floor(lvl('Ranged') * 1.5);
  const mage = 0.325 * Math.floor(lvl('Magic') * 1.5);

  return Math.floor(base + Math.max(melee, range, mage));
}

// Lines 0–24: skills. Remaining lines follow ACTIVITY_ORDER (others / minigames / bosses interleaved).
// Unmapped trailing lines are ignored.
function parseCsv(text: string, username: string): HiscoresData {
  const lines = text.trim().split('\n').map((l) => l.trim());
  if (lines.length < SKILLS.length) {
    throw new Error('Unexpected hiscores response format');
  }

  const skills: SkillEntry[] = SKILLS.map((name, i) => {
    // ?? NaN: a malformed/short CSV line leaves later destructured values
    // undefined even though .map(Number) types the whole line as number[] -
    // NaN keeps every comparison below false (same as today) without a `!`
    // that would otherwise be asserting something the line didn't guarantee.
    const [rank, level, xp] = lines[i].split(',').map(Number);
    const r = rank ?? NaN;
    const l = level ?? NaN;
    const x = xp ?? NaN;
    return {
      name,
      rank: r > 0 ? r : null,
      level: l > 0 ? l : 1,
      xp: x >= 0 ? x : 0
    };
  });

  const activityLines = lines.slice(SKILLS.length);
  const bosses: ScoredEntry[] = [];
  const minigames: ScoredEntry[] = [];
  const others: ScoredEntry[] = [];

  ACTIVITY_ORDER.forEach((activity, i) => {
    if (activity.category === 'unknown' || activity.name === null) return;
    const line = activityLines[i];
    if (!line) return;
    const [rank, score] = line.split(',').map(Number);
    const r = rank ?? NaN;
    const s = score ?? NaN;
    if (r <= 0 && s <= 0) return; // not unlocked/attempted, skip from display
    const entry: ScoredEntry = {
      name: activity.name,
      rank: r > 0 ? r : null,
      score: s > 0 ? s : 0
    };
    if (activity.category === 'bosses') bosses.push(entry);
    else if (activity.category === 'minigames') minigames.push(entry);
    else others.push(entry);
  });

  bosses.sort((a, b) => b.score - a.score);
  minigames.sort((a, b) => b.score - a.score);

  return {
    username,
    combatLevel: combatLevel(skills),
    totalLevel: skills[0]!.level,
    totalXp: skills[0]!.xp,
    skills,
    bosses,
    minigames,
    others
  };
}

// Jagex index_lite.ws CSV; 60s keyed cache; 404 = unknown player.
export async function fetchHiscores(username: string): Promise<HiscoresData> {
  const key = username.toLowerCase();
  return cachedByKey(cache, key, CACHE_TTL_MS, async () => {
    const url = `https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws?player=${encodeURIComponent(username)}`;
    const res = await fetchWithUserAgent(url);

    if (res.status === 404) {
      throw httpError('Player not found', 404);
    }
    if (!res.ok) {
      throw httpError('Hiscores lookup failed', 502);
    }

    return parseCsv(await res.text(), username);
  });
}
