/**
 * The draft every import source shares, and the gate every draft passes.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The photo reader produces a draft; the owner checks it; one Create writes
 * it. Between those two moments the draft crossed the browser, which makes
 * it user input: names, prices and marks are re-checked here before anything
 * is written. What is deliberately not happening here is invention -- a
 * price that cannot be read is never a free dish, and a dish the menu never
 * marked is never vegetarian. In India the marker is not decoration.
 */

/** One parsed dish. */
export type ImportedItem = {
  name: string;
  /** Paise. */
  pricePaise: number;
  description: string | null;
  /** true/false = the source marked it. null = the source never said. */
  isVeg: boolean | null;
  /**
   * Portions the menu printed beside one dish ("Half 240 / Full 420").
   * Absent for dishes sold one way — a dish is never assumed to have
   * portions, and the base price is the smallest printed portion.
   */
  variants?: ImportedVariant[];
};

/** One printed portion of a dish. */
export type ImportedVariant = {
  /** The portion word as printed: "Half", "Full", "Small"... */
  name: string;
  /** Paise. */
  pricePaise: number;
};

export type ImportedCategory = {
  name: string;
  items: ImportedItem[];
};

export type ImportIssue = {
  /** The line as it appeared, so the owner can find it in their own document. */
  line: string;
  reason: string;
};

export type MenuImportDraft = {
  categories: ImportedCategory[];
  /** Lines that could not become a dish. Shown, never silently dropped. */
  issues: ImportIssue[];
  /** Names dropped because the same name and price already appeared. */
  duplicates: number;
};

/** Refuse anything that is not a menu. Bounded so one upload cannot flood a page. */
export const MAX_IMPORT_ITEMS = 400;
export const MAX_IMPORT_CATEGORIES = 60;

/**
 * Validate a draft that arrived from the browser.
 *
 * The review screen posts the draft back, and a draft is user input like any
 * other: names are length-checked, prices must be positive whole paise, and
 * the counts are capped. Anything else is dropped rather than written.
 */
export function sanitiseDraft(input: unknown): MenuImportDraft {
  const empty: MenuImportDraft = { categories: [], issues: [], duplicates: 0 };
  if (!input || typeof input !== 'object') return empty;

  const raw = input as { categories?: unknown };
  if (!Array.isArray(raw.categories)) return empty;

  const categories: ImportedCategory[] = [];
  let items = 0;

  for (const entry of raw.categories.slice(0, MAX_IMPORT_CATEGORIES)) {
    if (!entry || typeof entry !== 'object') continue;
    const category = entry as { name?: unknown; items?: unknown };
    const name = typeof category.name === 'string' ? category.name.trim().slice(0, 60) : '';
    if (name === '' || !Array.isArray(category.items)) continue;

    const kept: ImportedItem[] = [];
    for (const line of category.items) {
      if (items >= MAX_IMPORT_ITEMS) break;
      if (!line || typeof line !== 'object') continue;
      const item = line as {
        name?: unknown;
        pricePaise?: unknown;
        description?: unknown;
        isVeg?: unknown;
        variants?: unknown;
      };
      const itemName = typeof item.name === 'string' ? item.name.trim().slice(0, 120) : '';
      const price = typeof item.pricePaise === 'number' ? Math.round(item.pricePaise) : 0;
      if (itemName === '' || !Number.isSafeInteger(price) || price <= 0) continue;

      // Portions survive the round trip the same way: six at most, each with a
      // printed name and a real price, anything malformed dropped.
      const variants: ImportedVariant[] = Array.isArray(item.variants)
        ? item.variants
            .slice(0, 6)
            .map((entry) => {
              const variant = (entry ?? {}) as { name?: unknown; pricePaise?: unknown };
              const name = typeof variant.name === 'string' ? variant.name.trim().slice(0, 40) : '';
              const variantPrice =
                typeof variant.pricePaise === 'number' ? Math.round(variant.pricePaise) : 0;
              return name !== '' && Number.isSafeInteger(variantPrice) && variantPrice > 0
                ? { name, pricePaise: variantPrice }
                : null;
            })
            .filter((entry): entry is ImportedVariant => entry !== null)
        : [];

      kept.push({
        name: itemName,
        pricePaise: price,
        description: typeof item.description === 'string' ? item.description.trim().slice(0, 300) || null : null,
        // Three states survive the round trip. Anything that is not an
        // explicit true/false is unmarked -- never a silent veg default.
        isVeg: item.isVeg === true ? true : item.isVeg === false ? false : null,
        ...(variants.length > 0 ? { variants } : {}),
      });
      items += 1;
    }

    // A section with no dishes would be an empty heading on the menu.
    if (kept.length > 0) categories.push({ name, items: kept });
  }

  return { categories, issues: [], duplicates: 0 };
}
