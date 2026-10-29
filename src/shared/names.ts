/** A player name as the game shows it, folded for comparison: no non-breaking spaces, trimmed, lower case. */
export function foldName(name: string): string {
  return name.replace(/\u00A0/g, ' ').trim().toLowerCase();
}
