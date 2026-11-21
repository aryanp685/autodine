/**
 * Search across a menu a guest is already looking at.
 *
 * WHY CLIENT-SIDE AND NOT A QUERY
 *
 * The whole menu is already in the page -- it has to be, because a guest on
 * restaurant wi-fi is not waiting for a round trip per keystroke. Filtering
 * here is instant, works on a flaky connection, and needs no new endpoint, no
 * database index and no server-side search surface to secure.
 *
 * WHAT COUNTS AS A MATCH
 *
 * Name first, then the description, then the course it belongs to. That is the
 * order a hungry person thinks in: "paneer", "something with mint", "a dessert".
 * Every word has to match somewhere, so "paneer tikka" narrows rather than
 * widens -- a search that ORs its words is the classic way to return the whole
 * menu for a two-word query.
 */

export type SearchableDish = {
  name: string;
  desc?: string | null;
  /** Category id, matched against the category names passed in. */
  category?: string;
};

/**
 * Lower-case, strip accents, collapse whitespace.
 *
 * The accent stripping matters for the same reason it matters on a keyboard:
 * someone types "biriyani" or "crème" and expects the dish either way. NFKD
 * plus a combining-mark strip is the short version of a transliteration table.
 */
export function normalise(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Dishes whose name, description or course contain every word of the query.
 *
 * An empty (or whitespace-only) query returns the list untouched -- callers
 * rely on that to mean "no search is running", so it must never be a special
 * case they have to check first.
 */
export function filterDishes<T extends SearchableDish>(
  items: readonly T[],
  query: string,
  categoryNames: Readonly<Record<string, string>> = {},
): T[] {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...items];

  return items.filter((item) => {
    const haystack = normalise(
      [item.name, item.desc ?? '', categoryNames[item.category ?? ''] ?? ''].join(' '),
    );
    return words.every((word) => haystack.includes(word));
  });
}
