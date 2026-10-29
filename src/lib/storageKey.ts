import { httpError } from './errors.js';
import { foldName } from '../shared/names.js';

export { foldName };

const USERNAME_RE = /^[a-z0-9 _-]{1,20}$/;

/** The folded name, checked so it is safe as a file name. */
export function storageKey(username: string): string {
  const key = foldName(username);
  if (!USERNAME_RE.test(key)) {
    throw httpError('Invalid username', 400);
  }
  return key;
}
