// Pulls Combat Achievement task names from the OSRS Wiki Bucket API and writes
// src/lib/combat-achievement-metadata.json, keyed by the varbit slug the plugin
// syncs (the part between CA_TASK_ and _COMPLETED in VarbitID).
//
//   node scripts/scrape-combat-achievement-metadata.mjs
//   node scripts/scrape-combat-achievement-metadata.mjs --check
//
// Not part of `npm run build` — same offline pattern as scrape-quest-metadata.mjs.

import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';

import { LIB_DIR, USER_AGENT } from './lib/wiki.mjs';

const OUT_FILE = join(LIB_DIR, 'combat-achievement-metadata.json');

// Keep in sync with parseTaskPrefix() in src/lib/combatachievements.ts, which
// applies the same token list at runtime to slugs this scrape didn't match.
// The two cannot share a module across the .mjs/.ts boundary without a build
// step the scrapers deliberately avoid.
const TYPE_RE = /^(KILLCOUNT|MECHANICAL|PERFECTION|STAMINA|RESTRICTION|SPEED|ACCURACY|FORTITUDE|DURATION|RESTRAINT|PARTNER|SOLO|TRIO|DUO|QUAD|GROUP|RAID|CHALLENGE|TASK|COMBO|DEFENCE|OFFENCE|OFFENSE|FILTER)$/i;

// Varbit monster prefix → wiki bucket `monster` field. Codenames differ from
// display names and from a naive slug of the wiki title.
const MONSTER_PREFIX_TO_WIKI = {
  ABBERANT_SPECTRE: 'Aberrant Spectre',
  ABYSSALSIRE: 'Abyssal Sire',
  ARMADYL: 'Kree\'arra',
  BANDOS: 'General Graardor',
  BARROWS: 'Barrows',
  BASILISK_KNIGHT: 'Basilisk Knight',
  BLACK_DRAGON: 'Black Dragon',
  BLOODVELD: 'Bloodveld',
  BRUTAL_BLACK_DRAGON: 'Brutal Black Dragon',
  BRYOPHYTA: 'Bryophyta',
  CALLISTO: 'Callisto',
  CATA_BOSS: 'Cerberus',
  CERBERUS: 'Cerberus',
  CHAOSELE: 'Chaos Elemental',
  CHAOSFANATIC: 'Chaos Fanatic',
  CORP: 'Corporeal Beast',
  CRAZYARCHAEOLOGIST: 'Crazy Archaeologist',
  DEMONIC_GORILLA: 'Demonic Gorilla',
  DERANGEDARCHAEOLOGIST: 'Deranged Archaeologist',
  FILTER: 'Non-boss',
  FIRE_GIANT: 'Fire Giant',
  GALVEK: 'Galvek',
  GARGBOSS: 'Grotesque Guardians',
  GARGOYLE: 'Gargoyle',
  GAUNTLET: 'Crystalline Hunllef',
  GAUNTLET_HM: 'Corrupted Hunllef',
  GIANT: 'Giants',
  GLOUGH: 'Glough',
  GREATER_DEMON: 'Greater Demon',
  HELLHOUND: 'Hellhound',
  HESPORI: 'Hespori',
  HILLGIANT_BOSS: 'Giants',
  HYDRABOSS: 'Alchemical Hydra',
  JAD: 'TzTok-Jad',
  KALPHITE: 'Kalphite Queen',
  KBD: 'King Black Dragon',
  KRAKEN_BOSS: 'Kraken',
  KURASK: 'Kurask',
  LIZARDMAN_SHAMAN: 'Lizardman Shaman',
  MIMIC: 'The Mimic',
  MOLE: 'Giant Mole',
  NIGHTMARE: 'The Nightmare',
  PRIME: 'Dagannoth Prime',
  REX: 'Dagannoth Rex',
  SARACHNIS: 'Sarachnis',
  SARADOMIN: 'Commander Zilyana',
  SCORPIA: 'Scorpia',
  SEREN: 'Fragment of Seren',
  SKELETAL_WYVERN: 'Skeletal Wyvern',
  SNAKEBOSS: 'Zulrah',
  SUPREME: 'Dagannoth Supreme',
  TEMPOROSS: 'Tempoross',
  THEATREOFBLOOD: 'Theatre of Blood',
  THEATREOFBLOOD_HARD: 'Theatre of Blood: Hard Mode',
  THEATREOFBLOOD_STORY: 'Theatre of Blood: Entry Mode',
  THERMY: 'Thermonuclear Smoke Devil',
  THRALL: 'Whisperer',
  TZHAARKETRAK: 'TzKal-Zuk',
  VENENATIS: 'Venenatis',
  VETION: 'Vet\'ion',
  VORKATH: 'Vorkath',
  WINTERTODT: 'Wintertodt',
  WYRM: 'Wyrm',
  XERICCHAMBERS: 'Chambers of Xeric',
  XERICCHAMBERS_CHALLENGE: 'Chambers of Xeric: Challenge Mode',
  ZALCANO: 'Zalcano',
  ZAMORAK: 'K\'ril Tsutsaroth',
  ZUK: 'TzKal-Zuk',
};

function findRuneliteApiJar() {
  const base = join(homedir(), '.gradle/caches/modules-2/files-2.1/net.runelite/runelite-api');
  let best = null;
  for (const ver of readdirSync(base)) {
    for (const hash of readdirSync(join(base, ver))) {
      for (const file of readdirSync(join(base, ver, hash))) {
        if (file.endsWith('.jar')) {
          const full = join(base, ver, hash, file);
          if (!best || statSync(full).mtimeMs > statSync(best).mtimeMs) best = full;
        }
      }
    }
  }
  if (!best) throw new Error('Could not find runelite-api jar in Gradle cache');
  return best;
}

function varbitTaskSlugs() {
  const jar = findRuneliteApiJar();
  const out = execSync(`javap -classpath "${jar}" -public net.runelite.api.gameval.VarbitID`, { encoding: 'utf8' });
  return [...out.matchAll(/CA_TASK_(.+)_COMPLETED/g)].map((m) => m[1]);
}

function typeSlug(type) {
  return type.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseVarbitSlug(slug) {
  const parts = slug.split('_');
  const index = Number(parts.at(-1));
  const typeToken = parts.at(-2);
  if (!Number.isInteger(index) || index < 1 || !typeToken || !TYPE_RE.test(typeToken)) {
    return null;
  }
  const prefix = parts.slice(0, -2).join('_');
  return { prefix, type: typeToken.toUpperCase(), index };
}

async function fetchWikiTasks() {
  const url = "https://oldschool.runescape.wiki/api.php?action=bucket&format=json&query=bucket('combat_achievement').select('id','name','monster','tier','type').limit(2000).run()";
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Wiki bucket API ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.bucket)) throw new Error('Wiki bucket response missing bucket array');
  return json.bucket;
}

function buildWikiIndex(tasks) {
  const byMonster = new Map();
  for (const task of tasks) {
    if (!byMonster.has(task.monster)) byMonster.set(task.monster, []);
    byMonster.get(task.monster).push(task);
  }

  const byMonsterType = new Map();
  for (const [monster, list] of byMonster) {
    const groups = new Map();
    for (const task of list) {
      const key = typeSlug(task.type);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }
    for (const [typeKey, typeList] of groups) {
      typeList.sort((a, b) => a.id - b.id);
      byMonsterType.set(`${monster}\0${typeKey}`, typeList);
    }
  }
  return byMonsterType;
}

function buildVarbitMappings(slugs, wikiByMonsterType) {
  const mapping = new Map();
  const groups = new Map();

  for (const slug of slugs) {
    const parsed = parseVarbitSlug(slug);
    if (!parsed) continue;
    const key = `${parsed.prefix}\0${parsed.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ slug, index: parsed.index });
  }

  for (const [key, entries] of groups) {
    const [prefix, type] = key.split('\0');
    const wikiMonster = MONSTER_PREFIX_TO_WIKI[prefix];
    if (!wikiMonster) continue;

    const wikiTasks = wikiByMonsterType.get(`${wikiMonster}\0${type}`);
    if (!wikiTasks?.length) continue;

    entries.sort((a, b) => a.index - b.index);
    for (let i = 0; i < entries.length && i < wikiTasks.length; i++) {
      mapping.set(entries[i].slug, wikiTasks[i]);
    }
  }

  return mapping;
}

async function scrape() {
  const slugs = varbitTaskSlugs();
  const wikiTasks = await fetchWikiTasks();
  const wikiByMonsterType = buildWikiIndex(wikiTasks);
  const resolved = buildVarbitMappings(slugs, wikiByMonsterType);

  const tasks = [];
  const unmatched = [];

  for (const slug of slugs.sort()) {
    const wiki = resolved.get(slug);
    if (!wiki) {
      unmatched.push(slug);
      continue;
    }
    tasks.push({
      slug,
      name: wiki.name,
      monster: wiki.monster,
      tier: wiki.tier,
      type: wiki.type,
    });
  }

  if (tasks.length < 350) {
    const unmatchedPrefixes = [...new Set(unmatched.map((s) => parseVarbitSlug(s)?.prefix).filter(Boolean))].sort();
    throw new Error(
      `Only mapped ${tasks.length}/${slugs.length} varbit slugs — refusing to write a partial file. ` +
      `Unmatched prefixes: ${unmatchedPrefixes.join(', ')}`
    );
  }
  if (unmatched.length) {
    console.warn(`Warning: ${unmatched.length} varbit slug(s) had no wiki match (will fall back to title-case on the site):`);
    for (const slug of unmatched.slice(0, 20)) console.warn(`  ${slug}`);
    if (unmatched.length > 20) console.warn(`  ... and ${unmatched.length - 20} more`);
  }

  const payload = {
    source: 'https://oldschool.runescape.wiki/api.php (bucket combat_achievement)',
    scrapedAt: new Date().toISOString(),
    tasks,
    unmatched,
  };

  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${tasks.length} tasks to ${OUT_FILE}`);
}

function check() {
  const slugs = varbitTaskSlugs();
  const file = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  const bySlug = new Map(file.tasks.map((t) => [t.slug, t]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length) {
    console.error(`Metadata missing ${missing.length} varbit slug(s):`);
    for (const slug of missing.slice(0, 30)) console.error(`  ${slug}`);
    process.exit(1);
  }
  console.log(`Metadata covers all ${slugs.length} varbit slugs`);
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  check();
} else {
  await scrape();
}
