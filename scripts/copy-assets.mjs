// tsc only emits .ts -> .js; non-TS assets read at runtime with readFileSync
// (lib/image_name_conversion.json, lib/quest-metadata.json,
// lib/leagues-task-metadata.json) have to be copied into dist/ by hand.
import { copyFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
mkdirSync(path.join(root, 'dist', 'lib'), { recursive: true });
mkdirSync(path.join(root, 'dist', 'lib', 'fixtures'), { recursive: true });

for (const asset of ['image_name_conversion.json', 'quest-metadata.json', 'leagues-task-metadata.json', 'combat-achievement-metadata.json']) {
  copyFileSync(path.join(root, 'src', 'lib', asset), path.join(root, 'dist', 'lib', asset));
}
copyFileSync(
  path.join(root, 'src', 'lib', 'fixtures', 'sync-payload.json'),
  path.join(root, 'dist', 'lib', 'fixtures', 'sync-payload.json'),
);
