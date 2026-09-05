import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadJsonAsset, readJsonOrDefault, storagePathFor } from './jsonStore.js';
import { atomicWriteFile } from './atomicWrite.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-store-test-'));
after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

test('storagePathFor puts one .json file per key in the directory', () => {
  assert.equal(storagePathFor('/data/sync', 'zezima'), path.join('/data/sync', 'zezima.json'));
});

// The distinction this function exists for: a file that was never written is a
// normal empty state, but a file that exists and is unreadable is a fault the
// caller must not mistake for one.
test('readJsonOrDefault falls back for a missing file', async () => {
  assert.deepEqual(await readJsonOrDefault(path.join(tmp, 'nope.json'), { a: 1 }), { a: 1 });
  assert.equal(await readJsonOrDefault(path.join(tmp, 'nope.json'), null), null);
});

test('readJsonOrDefault rethrows on a corrupt file rather than looking empty', async () => {
  const corrupt = path.join(tmp, 'corrupt.json');
  await fs.writeFile(corrupt, '{not json', 'utf8');
  await assert.rejects(() => readJsonOrDefault(corrupt, { a: 1 }), SyntaxError);
});

test('readJsonOrDefault round-trips what atomicWriteFile wrote', async () => {
  const file = path.join(tmp, 'nested', 'deep', 'value.json');
  await atomicWriteFile(file, JSON.stringify({ itemIds: [1, 2, 3] }));
  assert.deepEqual(await readJsonOrDefault(file, null), { itemIds: [1, 2, 3] });
});

// Temp-then-rename is only atomic against a reader. Concurrent writers to the
// same target used to race: on Windows, renaming over a file another handle
// holds fails with EPERM, which surfaced as a 500 on rapid watchlist toggles.
test('concurrent writes to the same file all succeed, and none is left half-written', async () => {
  const file = path.join(tmp, 'race.json');
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => atomicWriteFile(file, JSON.stringify({ n: i }))),
  );

  const leftovers = (await fs.readdir(tmp)).filter((n) => n.includes('.tmp'));
  assert.deepEqual(leftovers, [], 'no scratch files left behind');
  // Whoever renamed last wins, but the file is always one complete document.
  const written = await readJsonOrDefault<{ n: number } | null>(file, null);
  assert.equal(typeof written?.n, 'number');
});

test('writes to different files still run concurrently', async () => {
  const files = Array.from({ length: 5 }, (_, i) => path.join(tmp, `parallel-${i}.json`));
  await Promise.all(files.map((f, i) => atomicWriteFile(f, JSON.stringify({ i }))));
  for (const [i, f] of files.entries()) {
    assert.deepEqual(await readJsonOrDefault(f, null), { i });
  }
});

test('loadJsonAsset reads an asset relative to the calling module', () => {
  const meta = loadJsonAsset<{ tasks: unknown[] }>(import.meta.url, 'leagues-task-metadata.json');
  assert.ok(Array.isArray(meta.tasks) && meta.tasks.length > 0);
});
