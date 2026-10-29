// Shared upstream-fetch plumbing: the User-Agent header every outbound call
// needs, a timeout, and the small TTL caches used by hiscores.ts and prices.ts.

// The OSRS Wiki API etiquette asks callers to identify the app with a contact
// method. Defaults to the project repo; a deployer can point it at their own
// contact via WIKI_API_CONTACT.
const CONTACT = process.env.WIKI_API_CONTACT?.trim()
  || 'https://github.com/Ronovo/Personal-RuneScape-Tracker';
const USER_AGENT = `osrs-tracker (+${CONTACT})`;

const FETCH_TIMEOUT_MS = 15_000;

export function fetchWithUserAgent(url: string): Promise<Response> {
  return fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/** An image on the OSRS Wiki, by its file name. */
export function wikiImageUrl(fileName: string): string {
  return `https://oldschool.runescape.wiki/images/${encodeURIComponent(fileName.replace(/ /g, '_'))}`;
}

// Keyed cache (e.g. by lowercased username): re-fetches once the entry is
// older than ttlMs, otherwise returns the cached value. Expired entries are
// swept on each miss, so the store only holds what was fetched within ttlMs.
export async function cachedByKey<T>(
  store: Map<string, { at: number; data: T }>,
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = store.get(key);
  if (cached && Date.now() - cached.at < ttlMs) return cached.data;
  const data = await fetcher();
  const now = Date.now();
  for (const [k, entry] of store) {
    if (now - entry.at >= ttlMs) store.delete(k);
  }
  store.set(key, { at: now, data });
  return data;
}

// Same TTL idiom for a single module-level cache slot (no key) - mapping,
// movers, latest, day, and flip-rows caches in prices.ts all just hold one
// value at a time.
export function makeCacheSlot<T>(ttlMs: number): { get(): T | null; set(data: T): void } {
  let entry: { at: number; data: T } | null = null;
  return {
    get(): T | null {
      return entry && Date.now() - entry.at < ttlMs ? entry.data : null;
    },
    set(data: T): void {
      entry = { at: Date.now(), data };
    }
  };
}
