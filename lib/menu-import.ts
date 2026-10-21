/**
 * Reading a menu out of pasted text.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A restaurant that is already open has a menu -- a printed one, a PDF, a
 * WhatsApp image somebody photographed. Typing forty dishes into an editor,
 * one price at a time, is the slowest part of adopting this product and the
 * part most likely to end in an abandoned account.
 *
 * WHAT IS DELIBERATELY NOT HAPPENING HERE
 *
 * Nothing is guessed about money. A line whose price cannot be read is NOT
 * imported and NOT dropped: it is returned as an issue, with the original
 * text, so the owner sees exactly what was skipped. A dish with no price is
 * a dish that cannot be ordered, and a menu import that quietly loses four
 * dishes is worse than one that refuses.
 *
 * Vegetable / non-vegetable is guessed from the dish name, because most
 * menus paste cleanly but rarely say "veg" on every line. It is a guess and
 * the review screen says so -- in India the marker is not decoration.
 */

/** One parsed dish. */
export type ImportedItem = {
  name: string;
  /** Paise. */
  pricePaise: number;
  description: string | null;
  isVeg: boolean;
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

/** Refuse anything that is not a menu. Bounded so one paste cannot flood a page. */
export const MAX_IMPORT_ITEMS = 400;
export const MAX_IMPORT_CATEGORIES = 60;
export const MAX_IMPORT_TEXT = 20_000;

const VEG_MARKERS = /^[*•·◦●○]+\s*/;

/**
 * A veg marker after the price: "Paneer Tikka 320 (V)", "Dal 240 [Veg]".
 *
 * Only bracketed forms are stripped. A bare trailing "V" would eat the last
 * letter of "Pav Bhaji" on the wrong menu, and a marker that is missing is a
 * guess the review screen already says out loud.
 */
const VEG_SUFFIX = /\s*[([]\s*(v|veg|n|nv|non[\s-]?veg)\s*[)\]]\s*$/i;

const EXPLICIT_NON_VEG = /\b(non[\s-]?veg|nonvegetarian|chicken|mutton|lamb|goat|fish|prawn|shrimp|egg|keema|kheema|bacon|ham|pork|beef|crab|squid|seafood)\b/i;

/**
 * Decoration a heading is wrapped in: dashes, stars, unicode rules, pipes.
 */
const CATEGORY_NOISE = /^[\s\-_=*~•·—–|]+|[\s\-_=*~•·—–|]+$/g;

const BOILERPLATE = /\b(tax|taxes|gst|vat|service charge|prices? \w* ?inclusive|inclusive of|copyright|www\.|@|phone|call us|timings|happy hours|terms|conditions)\b/i;

/**
 * A price at the end of a line, in the four shapes menus actually use:
 *   320      ₹320       Rs. 320      1,200.50      320/-      320 only
 */
const TRAILING_PRICE = /(?:(?:₹|rs\.?|inr)\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:\/-|\/--|only)?\s*\.?$/i;

/** Every price-shaped run in a line, for detecting "Half 180 / Full 320". */
const ANY_PRICE = /(?:(?:₹|rs\.?|inr)\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:\/-|\/--|only)?/gi;

const SIZE_TAIL = /[\s\-–—:/]*\b(half|full|small|large|regular|mini|single|double|quarter|qtr|plate|piece|pcs?)\s*$/i;

/**
 * "Butter Chicken Half" -> "Butter Chicken".
 *
 * Only used when a line priced the same dish twice, because that is the case
 * where the sizing word sits in front of a number instead of after the name.
 */
function dropSizeTail(value: string): string {
  let text = value;
  // Twice, because "Half plate" is two size words, not one.
  for (let i = 0; i < 2 && SIZE_TAIL.test(text); i += 1) text = text.replace(SIZE_TAIL, '');
  return text.trim();
}

/** Remove the dashes, stars and pipes a heading is wrapped in. */
function stripDecoration(value: string): string {
  return value.replace(/^#+\s*/, '').replace(CATEGORY_NOISE, '').trim();
}

function cleanName(value: string): string {
  return value
    .replace(VEG_MARKERS, '')
    // Numbering: "1. Paneer Tikka", "12) Dal Makhani".
    .replace(/^\s*[0-9]{1,3}\s*[.)]\s*/, '')
    .replace(/[.\-–—_·:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1,200.50" -> 120050 paise. Null when the number is not a usable price. */
export function parsePriceToPaise(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '');
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(cleaned)) return null;

  const [whole, fraction = ''] = cleaned.split('.');
  const rupees = Number(whole);
  if (!Number.isFinite(rupees)) return null;

  // A dish priced at 0 is almost always a parsing accident ("Paneer 0" from a
  // stock code), and a ₹0 dish on a live menu is a free dish.
  const paise = rupees * 100 + Number(fraction.padEnd(2, '0'));
  if (paise <= 0) return null;
  return paise;
}

/**
 * Does this line price the same dish twice, as "Half 240 / Full 420" does?
 *
 * A sizing word has to be present. Without that check "Chicken 65 360" -- a
 * real dish at a real restaurant -- reads as two prices and warns the owner
 * about a variant that does not exist. A warning that fires on ordinary
 * menus teaches people to ignore warnings.
 */
const SIZE_WORDS = /\b(half|full|small|large|regular|mini|single|double|quarter|qtr|plate|piece|pcs?)\b/i;

function hasVariantPricing(line: string): boolean {
  if (!SIZE_WORDS.test(line)) return false;
  return [...line.matchAll(ANY_PRICE)].filter((match) => parsePriceToPaise(match[1]) !== null).length > 1;
}

/** Where the first price-shaped number starts, for "Half 240 / Full 420". */
function firstPriceIndex(line: string): number {
  const match = ANY_PRICE.exec(line);
  ANY_PRICE.lastIndex = 0;
  return match ? match.index : -1;
}

const JOIN_WORDS = /^(and|&|of|the|with|in|on|to|a)$/i;

/**
 * Is this line a section heading rather than a dish with a missing price?
 *
 * Three acceptable shapes, in order of how sure we are:
 *
 *   shouted     "STARTERS"          nothing else looks like this
 *   punctuated  "Starters:"         the colon is the menu's own signal
 *   title case  "Main Course"       every word capitalised, and the line
 *                                   starts its own block (a blank line
 *                                   above it, or the top of the paste)
 *
 * The last one needs both halves. "Main Course" is a heading; "Special thali
 * on request" is a dish somebody forgot to price, and calling it a heading
 * would file every dish after it under a section named after one dish.
 */
function looksLikeCategory(line: string, startsBlock: boolean): boolean {
  const bare = line.replace(CATEGORY_NOISE, '').trim();
  if (bare === '') return false;
  if (TRAILING_PRICE.test(bare)) return false;
  if (bare.length > 60) return false;
  if (!/[a-z\u0900-\u097f]/i.test(bare)) return false;

  const shouted = bare === bare.toUpperCase();
  const punctuated = /:$/.test(line.trim());
  if (shouted || punctuated) return true;

  const words = bare.split(/\s+/);
  if (words.length > 6 || !startsBlock) return false;

  return words.every((word) => JOIN_WORDS.test(word) || /^[A-Z\u0900-\u097f]/.test(word));
}

/** Dish name from a line: everything before the trailing price. */
function nameFromLine(line: string): string {
  const marker = VEG_MARKERS.exec(line);
  const withoutMarker = marker ? line.slice(marker[0].length) : line;
  const price = TRAILING_PRICE.exec(withoutMarker);
  const head = price ? withoutMarker.slice(0, price.index) : withoutMarker;
  return cleanName(head);
}

/**
 * Named meat is non-veg, everything else is assumed veg.
 *
 * Assumed, and said out loud on the review screen. Most pasted menus do not
 * mark every dish, the editor's own default is veg, and a wrong "non-veg" on a
 * paneer dish is a worse mistake than an owner un-ticking dal makhani.
 */
function isVegGuess(name: string): boolean {
  return !EXPLICIT_NON_VEG.test(name);
}

/**
 * Read a pasted menu.
 *
 * Structure is inferred: a line with a price is a dish, a short line without
 * one is a section heading. Everything else is reported as an issue rather
 * than guessed at.
 */
export function parseMenuText(raw: string): MenuImportDraft {
  const issues: ImportIssue[] = [];
  const categories: ImportedCategory[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  /**
   * Blank lines are kept as a boolean rather than as rows: whether the line
   * above was blank is the only thing the parser needs from them, and it is
   * what separates a heading from an unpriced dish.
   */
  const rows = raw.replace(/\r\n?/g, '\n').split('\n');

  let current: ImportedCategory | null = null;
  let itemCount = 0;
  let previousWasBlank = true;

  for (const row of rows) {
    const line = row.trim();

    if (line === '') {
      previousWasBlank = true;
      continue;
    }

    const startsBlock = previousWasBlank;
    previousWasBlank = false;
    // Separator rows: "-----", "____", "====".
    if (/^[\s\-_=*~•·—–|]+$/.test(line)) continue;

    // A bracketed veg marker sits after the price, so it is removed before
    // the price is read from the end of the line.
    const suffix = VEG_SUFFIX.exec(line);
    const body = suffix ? line.slice(0, suffix.index) : line;
    const markedVeg = suffix ? /^(v|veg)/i.test(suffix[1]) : null;

    const priceMatch = TRAILING_PRICE.exec(body);

    /**
     * "Butter Chicken Half 240 Full 420" is one dish, priced twice. The name
     * is everything before the FIRST price; the last price is the one that
     * gets imported, so the dish is never free.
     */
    const variant = hasVariantPricing(body);
    const variantHead = variant
      ? dropSizeTail(cleanName(body.slice(0, Math.max(firstPriceIndex(body), 0))))
      : '';

    const name = priceMatch ? variantHead || nameFromLine(body) : '';

    if (!priceMatch || name === '') {
      if (BOILERPLATE.test(line)) {
        issues.push({ line, reason: 'Menu small print, not a dish.' });
        continue;
      }

      if (looksLikeCategory(line, startsBlock)) {
        const title = cleanName(stripDecoration(line)) || cleanName(line);
        current = { name: title, items: [] };
        categories.push(current);
        if (categories.length > MAX_IMPORT_CATEGORIES) {
          return {
            categories: [],
            issues: [{ line, reason: `More than ${MAX_IMPORT_CATEGORIES} sections — split the paste into smaller parts.` }],
            duplicates: 0,
          };
        }
        continue;
      }

      issues.push({
        line,
        reason: priceMatch
          ? 'A price is there but the dish name is missing.'
          : 'No price on this line, so it was not imported.',
      });
      continue;
    }

    const price = parsePriceToPaise(priceMatch[1]);
    if (price === null) {
      issues.push({ line, reason: 'That price could not be read as an amount.' });
      continue;
    }

    if (variant) {
      // "Half 180 / Full 320": the last price is used so the dish is not free,
      // but the second rate is called out — it has to become a variant.
      issues.push({
        line,
        reason: 'More than one price on this line. The last was used — add the other as a variant in the editor.',
      });
    }

    if (!current) {
      current = { name: 'Imported dishes', items: [] };
      categories.push(current);
    }

    const key = `${current.name}::${name.toLowerCase()}::${price}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    if (itemCount >= MAX_IMPORT_ITEMS) {
      return {
        categories,
        issues: [
          ...issues,
          { line, reason: `More than ${MAX_IMPORT_ITEMS} dishes — split the paste into smaller parts.` },
        ],
        duplicates,
      };
    }

    current.items.push({
      name,
      pricePaise: price,
      description: null,
      // A written marker beats the name guess, which is the weaker signal.
      isVeg: markedVeg ?? isVegGuess(name),
    });
    itemCount += 1;
  }

  return { categories, issues, duplicates };
}

/** Total dishes in a draft. */
export function draftItemCount(draft: MenuImportDraft): number {
  return draft.categories.reduce((sum, category) => sum + category.items.length, 0);
}

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
      const item = line as { name?: unknown; pricePaise?: unknown; description?: unknown; isVeg?: unknown };
      const itemName = typeof item.name === 'string' ? item.name.trim().slice(0, 120) : '';
      const price = typeof item.pricePaise === 'number' ? Math.round(item.pricePaise) : 0;
      if (itemName === '' || !Number.isSafeInteger(price) || price <= 0) continue;

      kept.push({
        name: itemName,
        pricePaise: price,
        description: typeof item.description === 'string' ? item.description.trim().slice(0, 300) || null : null,
        isVeg: item.isVeg !== false,
      });
      items += 1;
    }

    // A section with no dishes would be an empty heading on the menu.
    if (kept.length > 0) categories.push({ name, items: kept });
  }

  return { categories, issues: [], duplicates: 0 };
}

/**
 * Turn a model's answer into a draft.
 *
 * The model is asked for paise-free rupees, so the conversion happens here
 * with the same rounding as parsePriceToPaise. Anything malformed is dropped
 * by sanitiseDraft, so a hallucinated row cannot reach the database.
 */
export function draftFromAiAnswer(answer: unknown): MenuImportDraft {
  if (!answer || typeof answer !== 'object') return { categories: [], issues: [], duplicates: 0 };

  const raw = answer as { categories?: unknown };
  if (!Array.isArray(raw.categories)) return { categories: [], issues: [], duplicates: 0 };

  const categories = raw.categories.map((entry) => {
    const category = (entry ?? {}) as { name?: unknown; items?: unknown };
    const items = Array.isArray(category.items) ? category.items : [];
    return {
      name: typeof category.name === 'string' ? category.name : '',
      items: items.map((line) => {
        const item = (line ?? {}) as { name?: unknown; price?: unknown; pricePaise?: unknown; isVeg?: unknown; description?: unknown };
        const price =
          typeof item.pricePaise === 'number'
            ? item.pricePaise
            : typeof item.price === 'number'
              ? Math.round(item.price * 100)
              : typeof item.price === 'string'
                ? parsePriceToPaise(item.price)
                : null;

        return {
          name: typeof item.name === 'string' ? item.name : '',
          pricePaise: price,
          description: typeof item.description === 'string' ? item.description : null,
          isVeg: item.isVeg !== false,
        };
      }),
    };
  });

  // Reuse the same validation path as a browser-posted draft.
  const cleaned = sanitiseDraft({ categories });
  return { ...cleaned, issues: [], duplicates: 0 };
}
