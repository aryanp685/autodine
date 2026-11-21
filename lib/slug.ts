/**
 * Restaurant slugs — used in the public URL a guest scans, e.g.
 * /r/saffron-smoke. Keep them short, readable and URL-safe.
 */

/** Lowercase, hyphenated, ASCII. Empty input yields an empty string. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

/**
 * First unused slug. Tries `base`, then `base-2`, `base-3`, ...
 * Bounded so a pathological case cannot spin forever.
 */
export async function uniqueSlug(base: string, isTaken: (s: string) => Promise<boolean>): Promise<string> {
  const start = base || 'restaurant';
  if (!(await isTaken(start))) return start;
  for (let i = 2; i <= 200; i += 1) {
    const candidate = `${start}-${i}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Fall back to something unique rather than throwing: a signup should not
  // fail because 200 restaurants already picked the same name.
  return `${start}-${Date.now().toString(36)}`;
}
