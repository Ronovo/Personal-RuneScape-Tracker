// Quest type (quest vs miniquest) and membership status aren't in RuneLite's
// Quest enum, so the plugin sync can't carry them - it only sends id/name/state.
// This pulls them from the OSRS Wiki's JSON API and writes the result to
// src/lib/quest-metadata.json, which questmeta.ts joins onto the synced quests.
//
//   node scripts/scrape-quest-metadata.mjs           refresh the JSON
//   node scripts/scrape-quest-metadata.mjs --check   verify it decodes every
//                                                    name in data/sync/*.json
//
// Not part of `npm run build`: builds stay offline (the Dockerfile depends on
// that) and the wiki's quest list only moves a few times a year.

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { LIB_DIR, SYNC_DIR, USER_AGENT, WIKI, WIKI_API as API } from './lib/wiki.mjs';

const OUT_FILE = path.join(LIB_DIR, 'quest-metadata.json');

// A short list is far more likely to mean the wiki moved a template or renamed
// a category than that OSRS lost half its quests. Writing that file would make
// every membership/type filter silently return nothing, so bail instead.
const MIN_QUESTS = 150;
const MIN_MINIQUESTS = 15;
const MIN_F2P = 20;

async function apiAll(params) {
  const results = [];
  let cont = {};

  // Every list here fits in one or two pages at limit=500; the cap is just a
  // guard against a continue token that never resolves.
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ ...params, format: 'json', formatversion: '2', ...cont });
    const res = await fetch(`${API}?${query}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      throw new Error(`Wiki API ${res.status} for ${params.eititle ?? params.cmtitle}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(`Wiki API error: ${JSON.stringify(json.error)}`);
    }

    results.push(json);
    if (!json.continue) return results;
    cont = json.continue;
  }

  throw new Error(`Wiki API kept paginating for ${params.eititle ?? params.cmtitle}`);
}

// Pages that transclude an infobox template. This is the wiki's own marker for
// "this page is a quest", and much cleaner than Category:Quests, which also
// holds meta pages (Quests/List, Quests/Series) and stray items.
async function transcluders(template) {
  const pages = await apiAll({
    action: 'query', list: 'embeddedin', eititle: template, einamespace: '0', eilimit: '500'
  });
  return pages.flatMap((p) => p.query.embeddedin.map((e) => e.title));
}

async function categoryMembers(category) {
  const pages = await apiAll({
    action: 'query', list: 'categorymembers', cmtitle: category, cmnamespace: '0', cmlimit: '500'
  });
  return pages.flatMap((p) => p.query.categorymembers.map((m) => m.title));
}

async function scrape() {
  const [questPages, miniquestPages, f2p, members, future, discontinued] = await Promise.all([
    transcluders('Template:Infobox Quest'),
    transcluders('Template:Infobox Miniquest'),
    categoryMembers('Category:Free-to-play quests'),
    categoryMembers("Category:Members' quests"),
    categoryMembers('Category:Future content'),
    categoryMembers('Category:Discontinued content')
  ]);

  const excluded = new Set([...future, ...discontinued]);
  const f2pPages = new Set(f2p);
  const memberPages = new Set(members);
  const byPage = new Map();

  function classify(wikiPage, kind) {
    // Subpages are quick guides and RFD chapters, never quests in their own right.
    if (excluded.has(wikiPage) || wikiPage.includes('/')) return;
    // A page already claimed as a quest stays one - nothing transcludes both.
    if (byPage.has(wikiPage)) return;

    byPage.set(wikiPage, {
      // The wiki disambiguates "Vale Totems (miniquest)" from the Forestry
      // activity; in game, and so in the sync, it's just "Vale Totems".
      name: wikiPage.replace(/\s*\((?:mini)?quest\)$/i, ''),
      wikiPage,
      kind,
      // Miniquests sit in neither membership category - the wiki states all of
      // them are members-only.
      members:
        kind === 'miniquest' ? true
        : memberPages.has(wikiPage) ? true
        : f2pPages.has(wikiPage) ? false
        : null
    });
  }

  questPages.forEach((p) => classify(p, 'quest'));
  miniquestPages.forEach((p) => classify(p, 'miniquest'));

  const quests = [...byPage.values()].sort((a, b) => a.name.localeCompare(b.name));
  const unresolved = quests.filter((q) => q.members === null);
  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} quest(s) in neither membership category - did the wiki ` +
        `rename one?\n  ${unresolved.map((q) => q.wikiPage).join('\n  ')}`
    );
  }

  const counts = {
    quests: quests.filter((q) => q.kind === 'quest').length,
    miniquests: quests.filter((q) => q.kind === 'miniquest').length,
    f2p: quests.filter((q) => !q.members).length,
    members: quests.filter((q) => q.members).length
  };

  if (counts.quests < MIN_QUESTS || counts.miniquests < MIN_MINIQUESTS || counts.f2p < MIN_F2P) {
    throw new Error(
      `Implausibly small scrape (${counts.quests} quests, ${counts.miniquests} miniquests, ` +
        `${counts.f2p} f2p) - refusing to overwrite ${path.basename(OUT_FILE)}`
    );
  }

  return { quests, counts };
}

// Kept in step with lookupQuestMeta() in src/lib/questmeta.ts - --check is only
// worth anything if it decodes names the same way the server does.
function makeLookup(quests) {
  const byName = new Map(quests.map((q) => [q.name.toLowerCase(), q]));
  return (runeliteName) => {
    const key = runeliteName.trim().toLowerCase();
    const exact = byName.get(key);
    if (exact) return exact;

    // RuneLite sends "Recipe for Disaster - Evil Dave"; the wiki files those as
    // subpages, which the scrape drops. Fall back to the parent quest.
    const dash = key.indexOf(' - ');
    return dash > 0 ? byName.get(key.slice(0, dash)) ?? null : null;
  };
}

function check(quests) {
  const lookup = makeLookup(quests);
  let files;
  try {
    files = readdirSync(SYNC_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    console.log('No data/sync directory - nothing to check against.');
    return 0;
  }

  let unmatched = 0;
  for (const file of files) {
    const synced = JSON.parse(readFileSync(path.join(SYNC_DIR, file), 'utf8')).quests ?? [];
    const misses = synced.filter((q) => !lookup(q.name));
    console.log(`${file}: ${synced.length - misses.length}/${synced.length} decoded`);
    misses.forEach((q) => console.log(`  no wiki entry for "${q.name}"`));
    unmatched += misses.length;
  }
  return unmatched;
}

const { quests, counts } = await scrape();
console.log(
  `${counts.quests} quests, ${counts.miniquests} miniquests, ` +
    `${counts.f2p} free-to-play, ${counts.members} members (${quests.length} total)`
);

if (process.argv.includes('--check')) {
  const unmatched = check(quests);
  console.log(unmatched ? `\n${unmatched} name(s) failed to decode.` : '\nAll synced quest names decoded.');
  process.exit(unmatched ? 1 : 0);
}

writeFileSync(
  OUT_FILE,
  JSON.stringify({ source: WIKI, scrapedAt: new Date().toISOString(), quests }, null, 2) + '\n',
  'utf8'
);
console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);
