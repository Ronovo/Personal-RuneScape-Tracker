// Region/difficulty/activity type aren't in CompletedTaskRecord - the plugin
// sync only sends the task's id slug and when it was completed. This trims
// the Leagues Task Randomizer plugin's own leagues_tasks.json (its bundled,
// already-merged-and-classified task list) down to the fields
// leaguetaskmeta.ts needs, and writes the result to
// src/lib/leagues-task-metadata.json.
//
//   node scripts/import-leagues-task-metadata.mjs <path-to-leagues_tasks.json>
//   node scripts/import-leagues-task-metadata.mjs <path> --check   also verify
//     coverage against every taskId in data/sync/*.json
//
// leagues_tasks.json lives in the plugin's own repo at
// src/main/resources/com/leaguestasks/leagues_tasks.json - re-run this after
// pulling a plugin update that adds a new league's tasks. Not part of
// `npm run build`: builds stay offline, and the task list only moves when a
// new league ships.

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'src', 'lib', 'leagues-task-metadata.json');
const SYNC_DIR = path.join(ROOT, 'data', 'sync');

const [, , srcArg, ...flags] = process.argv;
const check = flags.includes('--check');

if (!srcArg) {
  console.error('Usage: node scripts/import-leagues-task-metadata.mjs <path-to-leagues_tasks.json> [--check]');
  process.exit(1);
}

const source = JSON.parse(readFileSync(srcArg, 'utf8'));
if (!Array.isArray(source) || source.length < 1000) {
  // A plugin resource this small almost certainly means the wrong file was
  // pointed at, not that the task list actually shrank by that much.
  throw new Error(`Expected an array of 1000+ tasks in ${srcArg}, got ${Array.isArray(source) ? source.length : typeof source}`);
}

const tasks = source.map((t) => ({
  id: t.id,
  name: t.name,
  region: t.region,
  difficulty: t.difficulty,
  activityType: t.activityType
}));

for (const t of tasks) {
  if (!t.id || !t.name || !t.region || !t.difficulty || !t.activityType) {
    throw new Error(`Task missing a required field: ${JSON.stringify(t)}`);
  }
}

const out = {
  source: 'leagues_tasks.json (Leagues Task Randomizer RuneLite plugin)',
  scrapedAt: new Date().toISOString(),
  tasks
};

writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${tasks.length} tasks to ${path.relative(ROOT, OUT_FILE)}`);

if (check) {
  const byId = new Set(tasks.map((t) => t.id));
  const files = readdirSync(SYNC_DIR).filter((f) => f.endsWith('.json'));
  let total = 0;
  let missing = new Set();

  for (const file of files) {
    const data = JSON.parse(readFileSync(path.join(SYNC_DIR, file), 'utf8'));
    for (const ct of data.completedTasks ?? []) {
      total++;
      if (!byId.has(ct.taskId)) missing.add(ct.taskId);
    }
  }

  console.log(`Checked ${total} completed task record(s) across ${files.length} synced player(s).`);
  if (missing.size) {
    console.log(`${missing.size} taskId(s) have no match (likely renamed/pruned by the plugin's scraper - shown as "Unknown" in the app):`);
    for (const id of missing) console.log(`  - ${id}`);
  } else {
    console.log('Every synced taskId matched.');
  }
}
