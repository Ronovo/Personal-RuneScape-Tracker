// Slug-to-label helpers.

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Turns a slug into display text: `WESTERN_PROVINCES` -> "Western Provinces",
 * `client-of-kourend` -> "Client Of Kourend". Case in the input doesn't matter,
 * which is what lets the SCREAMING_SNAKE varbit slugs and the kebab-case task
 * ids share one implementation.
 */
export function titleCaseSlug(slug: string, separator: string): string {
  return slug
    .split(separator)
    .map((word) => capitalize(word.toLowerCase()))
    .join(' ');
}
