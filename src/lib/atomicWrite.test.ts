import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFile } from './atomicWrite.js';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osrs-atomic-write-test-'));

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('writes to one file at the same moment land in order and leave no temp files', async () => {
  const target = path.join(tmpDir, 'nested', 'file.json');
  await Promise.all(Array.from({ length: 20 }, (_, i) => atomicWriteFile(target, String(i))));
  assert.equal(await fs.readFile(target, 'utf8'), '19');
  assert.deepEqual(await fs.readdir(path.dirname(target)), ['file.json']);
});

test('a rename that fails leaves no temp file behind and reports the failure', async () => {
  const target = path.join(tmpDir, 'occupied');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'keep.txt'), 'x');
  await assert.rejects(() => atomicWriteFile(target, 'new contents'));
  assert.deepEqual((await fs.readdir(tmpDir)).filter((name) => name.endsWith('.tmp')), []);
});
