import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

// One in-flight write per target path.
//
// Temp-then-rename is only atomic against a *reader*. Two writers racing the
// same target still collide on Windows, where renaming over a file another
// handle has open fails outright with EPERM - so a player clicking the
// watchlist star twice quickly could drop a save with a 500. Serialising per
// path removes the race and makes last-write-wins deterministic; it is the
// same chaining sync.ts uses to keep concurrent syncs from losing sections.
const writeChains = new Map<string, Promise<unknown>>();

async function writeOnce(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  // Random suffix so two writes to the same target in the same millisecond
  // can't pick the same temp path and clobber each other's rename.
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, data, 'utf8');
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Never leave the scratch file behind for a rename that didn't happen.
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Writes via a temp file in the same directory, then renames into place. */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const key = path.resolve(filePath);
  const prev = writeChains.get(key) ?? Promise.resolve();
  // Swallow the previous rejection so one failed write doesn't fail the next.
  const next = prev.catch(() => {}).then(() => writeOnce(filePath, data));
  writeChains.set(key, next);
  try {
    await next;
  } finally {
    if (writeChains.get(key) === next) {
      writeChains.delete(key);
    }
  }
}
