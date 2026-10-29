import { httpError } from './errors.js';

const USERNAME_RE = /^[a-z0-9 _-]{1,20}$/;
const NBSP = /\u00A0/g;

/** A player name as the game shows it, folded for comparison: no non-breaking spaces, trimmed, lower case. */
export function foldName(name: string): string {
  return name.replace(NBSP, ' ').trim().toLowerCase();
}

/** The folded name, checked so it is safe as a file name. */
export function storageKey(username: string): string {
  const key = foldName(username);
  if (!USERNAME_RE.test(key)) {
    throw httpError('Invalid username', 400);
  }
  return key;
}
