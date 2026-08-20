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

const SKILLS = [
  'Overall', 'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer',
  'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking',
  'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving',
  'Slayer', 'Farming', 'Runecraft', 'Hunter', 'Construction', 'Sailing'
];

// Non-boss activities, category_type=1 table 1-19 (index 0 is the unknown
// leading column and is handled separately in ACTIVITY_ORDER below).
const OTHER_ACTIVITIES = [
  'League Points', 'Deadman Points', 'Clue Scrolls (all)',
  'Clue Scrolls (beginner)', 'Clue Scrolls (easy)', 'Clue Scrolls (medium)',
  'Clue Scrolls (hard)', 'Clue Scrolls (elite)', 'Clue Scrolls (master)',
  'Collections Logged'
];

const MINIGAMES = [
  'Bounty Hunter - Hunter', 'Bounty Hunter - Rogue',
  'Bounty Hunter (Legacy) - Hunter', 'Bounty Hunter (Legacy) - Rogue',
  'LMS - Rank', 'PvP Arena - Rank', 'Soul Wars Zeal', 'Rifts closed',
  'Colosseum Glory'
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
const ACTIVITY_ORDER = [
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
  ...BOSSES.map((name) => ({ name, category: 'bosses' }))
];

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

// Calculated used Jagex's formula, since it is not returned in the API
// More info here : https://oldschool.runescape.wiki/w/Combat_level#Calculating_combat_level
function combatLevel(skills) {
  const lvl = (name) => skills.find((s) => s.name === name)?.level ?? 1;

  const base = 0.25 * (lvl('Defence') + lvl('Hitpoints') + Math.floor(lvl('Prayer') / 2));
  const melee = 0.325 * (lvl('Attack') + lvl('Strength'));
  const range = 0.325 * Math.floor(lvl('Ranged') * 1.5);
  const mage = 0.325 * Math.floor(lvl('Magic') * 1.5);

  return Math.floor(base + Math.max(melee, range, mage));
}

// Split and work through response. 
// Skills, Bosses, minigames, then clue scrolls
// We ignore anything else for now.
function parseCsv(text, username) {
  const lines = text.trim().split('\n').map((l) => l.trim());
  if (lines.length < SKILLS.length) {
    throw new Error('Unexpected hiscores response format');
  }

  const skills = SKILLS.map((name, i) => {
    const [rank, level, xp] = lines[i].split(',').map(Number);
    return {
      name,
      rank: rank > 0 ? rank : null,
      level: level > 0 ? level : 1,
      xp: xp >= 0 ? xp : 0
    };
  });

  const activityLines = lines.slice(SKILLS.length);
  const bosses = [];
  const minigames = [];
  const others = [];

  ACTIVITY_ORDER.forEach((activity, i) => {
    if (activity.category === 'unknown') return;
    const line = activityLines[i];
    if (!line) return;
    const [rank, score] = line.split(',').map(Number);
    const entry = {
      name: activity.name,
      rank: rank > 0 ? rank : null,
      score: score > 0 ? score : 0
    };
    if (rank <= 0 && score <= 0) return; // not unlocked/attempted, skip from display
    if (activity.category === 'bosses') bosses.push(entry);
    else if (activity.category === 'minigames') minigames.push(entry);
    else others.push(entry);
  });

  bosses.sort((a, b) => b.score - a.score);
  minigames.sort((a, b) => b.score - a.score);

  return {
    username,
    combatLevel: combatLevel(skills),
    totalLevel: skills[0].level,
    totalXp: skills[0].xp,
    skills,
    bosses,
    minigames,
    others
  };
}

// Calls for the Scores
export async function fetchHiscores(username) {
  const key = username.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws?player=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'osrs-tracker (personal LAN project)' }
  });

  if (res.status === 404) {
    throw Object.assign(new Error('Player not found'), { statusCode: 404 });
  }
  if (!res.ok) {
    throw Object.assign(new Error('Hiscores lookup failed'), { statusCode: 502 });
  }

  const data = parseCsv(await res.text(), username);
  cache.set(key, { data, at: Date.now() });
  return data;
}
