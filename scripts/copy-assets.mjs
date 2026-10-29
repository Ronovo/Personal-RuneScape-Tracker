// tsc only emits .ts -> .js; the JSON assets read at runtime with readFileSync
// have to be copied into dist/ by hand.
import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
mkdirSync(path.join(root, 'dist', 'lib'), { recursive: true });

for (const asset of readdirSync(path.join(root, 'src', 'lib')).filter((name) => name.endsWith('.json'))) {
  copyFileSync(path.join(root, 'src', 'lib', asset), path.join(root, 'dist', 'lib', asset));
}
