/**
 * Runs work once every earlier job under the same key has settled, so jobs on one key never overlap. A job that
 * fails doesn't hold up the next one.
 */
export function serialize<T>(chains: Map<string, Promise<unknown>>, key: string, work: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  chains.set(key, next);
  return next.finally(() => {
    if (chains.get(key) === next) {
      chains.delete(key);
    }
  });
}
