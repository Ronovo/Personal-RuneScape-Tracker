// tsc only emits .ts -> .js; non-TS assets referenced via readFileSync
// (lib/image_name_conversion.json) have to be copied into dist/ by hand.
import { copyFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
mkdirSync(path.join(root, 'dist', 'lib'), { recursive: true });
copyFileSync(
  path.join(root, 'src', 'lib', 'image_name_conversion.json'),
  path.join(root, 'dist', 'lib', 'image_name_conversion.json')
);
