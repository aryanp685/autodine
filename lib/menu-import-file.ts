/**
 * Reading a menu out of a structured file: CSV or Excel.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A restaurant that already keeps its menu in a spreadsheet should not have
 * to photograph it or paste it as text. The photo reader exists for paper;
 * this exists for the digital menu the owner already has. Both end at the
 * same review screen and the same one Create -- the source is the only
 * difference.
 *
 * WHAT IS DELIBERATELY NOT HAPPENING HERE
 *
 * Same rule as lib/menu-import.ts: nothing is guessed about money. A row
 * whose price cannot be read is reported as an issue with its own text, not
 * imported at ₹0 and not silently dropped. Veg is a three-state fact taken
 * from the owner's own column -- a blank cell is UNMARKED, never vegetarian.
 *
 * The output is a plain MenuImportDraft: the row mapping here is tested
 * without any spreadsheet library, and the file readers are thin wrappers
 * around it.
 */

import {
  MAX_IMPORT_CATEGORIES,
  MAX_IMPORT_ITEMS,
  parsePriceToPaise,
  type ImportIssue,
  type MenuImportDraft,
} from './menu-import';

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
