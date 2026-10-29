// Shared plumbing for the offline metadata scrapers.

import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LIB_DIR = path.join(ROOT, 'src', 'lib');
export const SYNC_DIR = path.join(ROOT, 'data', 'sync');

export const WIKI = 'https://oldschool.runescape.wiki';
export const WIKI_API = `${WIKI}/api.php`;

// Same shape the server sends (src/lib/http.ts): the OSRS Wiki asks callers to
// identify themselves with a contact method, and WIKI_API_CONTACT overrides
// the default here exactly as it does there.
const CONTACT = process.env.WIKI_API_CONTACT?.trim()
  || 'https://github.com/Ronovo/Personal-RuneScape-Tracker';
export const USER_AGENT = `osrs-tracker (+${CONTACT})`;
