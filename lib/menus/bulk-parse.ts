/**
 * Reading a menu out of bulk input: pasted text, a CSV, or an Excel file.
 *
 * WHY THIS EXISTS AT ALL
 *
 * An owner with twenty dishes should not type them one at a time. The
 * single-dish form stays the way in for one correction; this is the way in
 * for a list. It is the deterministic parser that used to sit behind the
 * import screen before that screen went photo-only -- revived for the
 * editor's bulk add, unchanged in its rules.
 *
 * WHAT IS DELIBERATELY NOT HAPPENING HERE
 *
 * Nothing is guessed about money. A line whose price cannot be read is
 * reported as an issue with its own text, not imported at ₹0 and not
 * silently dropped. Veg is a three-state fact: printed markers and the
 * dish's own name are evidence; a blank cell is UNMARKED, never vegetarian.
 *
 * Every source becomes the same shape -- a plain MenuImportDraft -- so the
 * row mapping is tested without any spreadsheet library, and the file
 * readers are thin wrappers around it.
 */

import {
  MAX_IMPORT_CATEGORIES,
  MAX_IMPORT_ITEMS,
  type ImportIssue,
  type ImportedCategory,
  type ImportedItem,
  type ImportedVariant,
  type MenuImportDraft,
} from '../menu-import';

// The batch caps the parsers enforce; re-exported so a caller finds them in
// one place next to the source-size caps below.
export { MAX_IMPORT_CATEGORIES, MAX_IMPORT_ITEMS };

/** A paste longer than this is not a menu. Bounded so one paste cannot flood a page. */
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

/**
 * "Half 240" — a portion word and its price. The shape menus use when one
 * dish is sold in more than one size. Only real portion words count:
 * "Chicken 65 360" is a dish, not a portion, and a false variant on an
 * ordinary line is a warning people learn to ignore.
 */
const VARIANT_PAIR =
  /\b(half|full|small|large|regular|mini|single|double|quarter|qtr)\b\s*(?:[:\-–—/]\s*)?(?:(?:₹|rs\.?|inr)\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;

/**
 * "Butter Chicken Half 240 / Full 420" -> two real portions, or null when the
 * line does not price one dish in portions. Names keep the printed word; the
 * dish's own price is the smallest portion, so the menu shows an honest entry
 * price instead of the last number the parser happened to reach.
 */
export function parseVariantPairs(line: string): ImportedVariant[] | null {
  const pairs: ImportedVariant[] = [];
  for (const match of line.matchAll(VARIANT_PAIR)) {
    const price = parsePriceToPaise(match[2]);
    if (price === null) continue;
    const word = match[1].toLowerCase();
    const name = word.charAt(0).toUpperCase() + word.slice(1);
    if (pairs.some((p) => p.name === name)) continue;
    pairs.push({ name, pricePaise: price });
  }
  return pairs.length >= 2 ? pairs : null;
}

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
 * What the dish's own NAME says about meat: named meat is non-veg, anything
 * else is UNMARKED -- not vegetarian.
 *
 * The old rule guessed veg for everything without meat in the name, and a
 * guess wearing a green mark is indistinguishable from the kitchen's promise.
 * Only the menu's own markers decide vegetarian; a name decides non-veg
 * because "Chicken 65" is printed evidence, not inference.
 */
function nonVegFromName(name: string): boolean | null {
  return EXPLICIT_NON_VEG.test(name) ? false : null;
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
     * "Butter Chicken Half 240 Full 420" is one dish sold in portions. Real
     * portion pairs become variants; a double price this parser cannot split
     * is still called out, because guessing which number is which portion is
     * exactly the invention this file refuses.
     */
    const variantPairs = parseVariantPairs(body);
    const variant = hasVariantPricing(body);
    const variantHead = variant
      ? dropSizeTail(cleanName(body.slice(0, Math.max(firstPriceIndex(body), 0))))
      : '';

    const name = priceMatch
      ? variantPairs
        ? cleanName(body.replace(VARIANT_PAIR, ' ').replace(ANY_PRICE, ' ').replace(/[/|·,]+/g, ' '))
        : variantHead || nameFromLine(body)
      : '';

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

    const listed = parsePriceToPaise(priceMatch[1]);
    if (listed === null) {
      issues.push({ line, reason: 'That price could not be read as an amount.' });
      continue;
    }

    // Portions carry their own prices; the dish's price is the smallest
    // portion, so the entry price shown on the menu is honest.
    const price = variantPairs ? Math.min(...variantPairs.map((v) => v.pricePaise)) : listed;

    if (!variantPairs && variant) {
      // Double pricing this parser could not split: the last price was used
      // so the dish is not free, and the other rate is called out.
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
      // A written marker beats the name signal, which is the weaker one.
      isVeg: markedVeg ?? nonVegFromName(name),
      ...(variantPairs ? { variants: variantPairs } : {}),
    });
    itemCount += 1;
  }

  return { categories, issues, duplicates };
}

/** Total dishes in a draft. */
export function draftItemCount(draft: MenuImportDraft): number {
  return draft.categories.reduce((sum, category) => sum + category.items.length, 0);
}

/** Both formats share one ceiling: a menu, not a database dump. */
export const MAX_MENU_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Column names we understand, matched case-insensitively against the header
 * row. A name column is the only requirement; anything else is optional and
 * unknown columns are ignored -- the spreadsheet may have costs and supplier
 * notes we must not import.
 */
const NAME_COLUMNS = /^(name|dish|item|dish name|item name|product)$/i;
const PRICE_COLUMNS = /^(price|rate|amount|cost|price \(inr\)|rate \(inr\)|mrp)$/i;
const CATEGORY_COLUMNS = /^(category|section|course|group|type)$/i;
const DESCRIPTION_COLUMNS = /^(description|desc|details|description text)$/i;
const VEG_COLUMNS = /^(veg|is veg|isveg|veg\/non-veg|veg or non-veg|food type)$/i;

const VEG_TRUE = /^(v|veg|vegetarian|true|yes|y|1)$/i;
const VEG_FALSE = /^(n|non|non-veg|nonveg|non vegetarian|false|no|0)$/i;

/** One row of any source, already flattened to text. */
type Cells = string[];

function rowText(cells: Cells): string {
  return cells.map((c) => c.trim()).filter((c) => c !== '').join(' · ').slice(0, 200);
}

/**
 * The three-state veg read. A blank or an unknown word is NULL -- the source
 * did not say, and AutoDine does not say on its behalf.
 */
export function parseVegCell(raw: string): boolean | null {
  const value = raw.trim();
  if (value === '') return null;
  if (VEG_TRUE.test(value)) return true;
  if (VEG_FALSE.test(value)) return false;
  return null;
}

/**
 * Map spreadsheet rows to a draft.
 *
 * The header row decides the columns; the category column forward-fills,
 * because spreadsheets put the section name once above its dishes, not on
 * every line. Everything else is the same discipline as the text parser:
 * price required, name required, unknown veg stays unmarked.
 */
export function rowsToDraft(rows: Cells[]): MenuImportDraft {
  const empty: MenuImportDraft = { categories: [], issues: [], duplicates: 0 };
  const issues: ImportIssue[] = [];

  const headerIndex = rows.findIndex((row) => row.some((cell) => NAME_COLUMNS.test(cell.trim())));
  if (headerIndex === -1) {
    return {
      ...empty,
      issues: [
        {
          line: rowText(rows[0] ?? []),
          reason:
            'No dish-name column was found. Name one column "name" (or "dish"), and one "price", then try again.',
        },
      ],
    };
  }

  const header = rows[headerIndex].map((cell) => cell.trim());
  const nameAt = header.findIndex((cell) => NAME_COLUMNS.test(cell));
  const priceAt = header.findIndex((cell) => PRICE_COLUMNS.test(cell));
  const categoryAt = header.findIndex((cell) => CATEGORY_COLUMNS.test(cell));
  const descriptionAt = header.findIndex((cell) => DESCRIPTION_COLUMNS.test(cell));
  const vegAt = header.findIndex((cell) => VEG_COLUMNS.test(cell));

  if (priceAt === -1) {
    return {
      ...empty,
      issues: [
        {
          line: rowText(header),
          reason: 'No price column was found. Name one column "price" (or "rate"), then try again.',
        },
      ],
    };
  }

  const categories: MenuImportDraft['categories'] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let items = 0;
  let lastCategory = '';

  for (const row of rows.slice(headerIndex + 1)) {
    if (row.every((cell) => cell.trim() === '')) continue;

    const name = (row[nameAt] ?? '').trim().slice(0, 120);
    const rawPrice = (row[priceAt] ?? '').trim();

    if (name === '') {
      issues.push({ line: rowText(row), reason: 'This row has no dish name, so it was not imported.' });
      continue;
    }

    // The category column is written once above a block of dishes; an empty
    // cell continues the previous section instead of starting a nameless one.
    const rawCategory = categoryAt === -1 ? '' : (row[categoryAt] ?? '').trim().slice(0, 60);
    if (rawCategory !== '') lastCategory = rawCategory;
    const categoryName = lastCategory === '' ? 'Imported dishes' : lastCategory;

    const price = rawPrice === '' ? null : parsePriceToPaise(rawPrice.replace(/[₹,]/g, '').replace(/[^0-9.]/g, ''));
    if (price === null) {
      issues.push({
        line: rowText(row),
        reason:
          rawPrice === ''
            ? 'No price on this row, so it was not imported.'
            : 'That price could not be read as an amount.',
      });
      continue;
    }

    const key = `${categoryName}::${name.toLowerCase()}::${price}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    if (items >= MAX_IMPORT_ITEMS) {
      issues.push({
        line: rowText(row),
        reason: `More than ${MAX_IMPORT_ITEMS} dishes — split the file into smaller parts.`,
      });
      break;
    }
    if (categories.length >= MAX_IMPORT_CATEGORIES && !categories.some((c) => c.name === categoryName)) {
      issues.push({
        line: rowText(row),
        reason: `More than ${MAX_IMPORT_CATEGORIES} sections — split the file into smaller parts.`,
      });
      break;
    }

    let category = categories.find((c) => c.name === categoryName);
    if (!category) {
      category = { name: categoryName, items: [] };
      categories.push(category);
    }

    category.items.push({
      name,
      pricePaise: price,
      description:
        descriptionAt === -1
          ? null
          : ((row[descriptionAt] ?? '').trim().slice(0, 300) || null),
      isVeg: vegAt === -1 ? null : parseVegCell(row[vegAt] ?? ''),
    });
    items += 1;
  }

  if (items === 0 && issues.length === 0) {
    issues.push({ line: '', reason: 'No dishes were found below the header row.' });
  }

  return { categories, issues, duplicates };
}

/**
 * RFC-4180-ish CSV reader: quoted fields, escaped quotes, commas and
 * newlines inside quotes, CRLF or LF, a leading BOM. Anything row-shaped
 * and plain survives; the mapping decides what a row means.
 */
export function parseCsvRows(text: string): Cells[] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: Cells[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV text -> draft. */
export function parseMenuCsv(text: string): MenuImportDraft {
  return rowsToDraft(parseCsvRows(text));
}

/**
 * XLSX bytes -> draft. The reader is imported lazily so the spreadsheet
 * library never ships to the browser.
 *
 * v9 returns every sheet as { sheet, data }; only the first is read, because
 * a menu file with a second sheet is usually price history or notes.
 */
export async function parseMenuXlsx(bytes: Buffer): Promise<MenuImportDraft> {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const sheets = (await readXlsxFile(bytes)) as Array<{ sheet: string; data: unknown[][] }>;
  const rows: Cells[] = (sheets[0]?.data ?? []).map((row) =>
    (row ?? []).map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
  );
  return rowsToDraft(rows);
}
