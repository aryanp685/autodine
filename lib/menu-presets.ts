/**
 * Categories almost every Indian restaurant has.
 *
 * These exist because the alternative was a blank field. An owner setting up
 * a menu had to invent and type every category name before they could add a
 * single item -- and an item with no category is invisible to diners, because
 * items_public reaches an item only through its category and that category's
 * published menu. Starting from zero meant the fastest path to a working menu
 * was also the easiest to get wrong.
 *
 * They are suggestions, not a fixed set. Each one is a toggle: present means
 * the chip removes it, absent means the chip adds it. Nothing is locked, and
 * a custom name is always one field away.
 *
 * Matching is case- and whitespace-folded so a category typed by hand -- say
 * "starters" -- is recognised as the same thing as the preset "Starters"
 * rather than showing a duplicate chip.
 */
export const PRESET_CATEGORIES = [
  'Starters',
  'Main Course',
  'Breads',
  'Rice & Biryani',
  'Beverages',
  'Desserts',
] as const;

/**
 * Folds a name so two spellings of one category compare equal.
 *
 * The singular/plural step exists because of what actually happened: an owner
 * typed "starter", then later added the "Starters" chip, and the menu ended up
 * with both -- one holding the items and one sitting empty. Case-folding alone
 * missed it, because "starter" and "starters" differ by more than case.
 *
 * Only a single trailing "s" comes off. That is enough for how these are
 * written in practice and it will not turn two different categories into one.
 */
export function normaliseCategoryName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/s$/, '');
}
