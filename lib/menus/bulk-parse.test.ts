import { describe, expect, it, vi } from 'vitest';
import {
  MAX_IMPORT_CATEGORIES,
  MAX_IMPORT_ITEMS,
  draftItemCount,
  parseCsvRows,
  parseMenuCsv,
  parseMenuText,
  parsePriceToPaise,
  parseVegCell,
  rowsToDraft,
} from './bulk-parse';

/**
 * The parser's job is to be boring and honest: a dish with a readable price
 * becomes a dish, and EVERYTHING else is reported. These tests are mostly
 * about the second half — the failure that hurts is a paste that looks fine
 * and has quietly lost four dishes.
 */

const names = (draft: ReturnType<typeof parseMenuText>) =>
  draft.categories.flatMap((category) => category.items.map((item) => item.name));

describe('parsePriceToPaise', () => {
  it('reads the shapes menus actually print', () => {
    expect(parsePriceToPaise('320')).toBe(32000);
    expect(parsePriceToPaise('1,200')).toBe(120000);
    expect(parsePriceToPaise('1,200.50')).toBe(120050);
    expect(parsePriceToPaise('99.9')).toBe(9990);
  });

  it('refuses anything that is not money', () => {
    expect(parsePriceToPaise('0')).toBeNull();
    expect(parsePriceToPaise('00.00')).toBeNull();
    expect(parsePriceToPaise('12.345')).toBeNull();
    expect(parsePriceToPaise('Rs 320')).toBeNull();
    expect(parsePriceToPaise('')).toBeNull();
  });
});

describe('parseMenuText', () => {
  const menu = [
    'STARTERS',
    'Paneer Tikka 320',
    'Chicken 65 360',
    '',
    'MAIN COURSE',
    'Dal Makhani 280',
    'Butter Chicken 420',
  ].join('\n');

  it('splits dishes into the section above them', () => {
    const draft = parseMenuText(menu);

    expect(draft.categories.map((category) => category.name)).toEqual(['STARTERS', 'MAIN COURSE']);
    expect(names(draft)).toEqual(['Paneer Tikka', 'Chicken 65', 'Dal Makhani', 'Butter Chicken']);
    expect(draft.issues).toEqual([]);
  });

  it('keeps the price in paise, never in rupees', () => {
    const draft = parseMenuText('Dal Makhani 280');
    expect(draft.categories[0].items[0].pricePaise).toBe(28000);
  });

  it('reads ₹, Rs., /- and "only" suffixes off the price', () => {
    const draft = parseMenuText(['Paneer Tikka ₹320', 'Dal Makhani Rs. 280', 'Naan 40/-', 'Lassi 90 only'].join('\n'));

    expect(draft.categories[0].items.map((item) => item.pricePaise)).toEqual([32000, 28000, 4000, 9000]);
    expect(names(draft)).toEqual(['Paneer Tikka', 'Dal Makhani', 'Naan', 'Lassi']);
  });

  it('strips numbering and decoration from dish names', () => {
    const draft = parseMenuText(['**STARTERS**', '1. Paneer Tikka 320', '12) Dal Makhani 280'].join('\n'));

    expect(draft.categories[0].name).toBe('STARTERS');
    expect(names(draft)).toEqual(['Paneer Tikka', 'Dal Makhani']);
  });

  it('puts dishes before any heading into one section instead of losing them', () => {
    const draft = parseMenuText(['Paneer Tikka 320', 'STARTERS', 'Dal Makhani 280'].join('\n'));

    expect(draft.categories[0].name).toBe('Imported dishes');
    expect(names(draft)).toEqual(['Paneer Tikka', 'Dal Makhani']);
  });

  describe('lines that cannot become a dish', () => {
    it('reports a dish with no price instead of dropping it', () => {
      const draft = parseMenuText(['STARTERS', 'Paneer Tikka 320', 'Special thali on request'].join('\n'));

      expect(names(draft)).toEqual(['Paneer Tikka']);
      expect(draft.issues).toHaveLength(1);
      expect(draft.issues[0].line).toBe('Special thali on request');
      expect(draft.issues[0].reason).toMatch(/no price/i);
    });

    it('reports a price with no dish name', () => {
      const draft = parseMenuText('320');
      expect(names(draft)).toEqual([]);
      expect(draft.issues[0].reason).toMatch(/name is missing/i);
    });

    it('does not treat the small print as a section heading', () => {
      const draft = parseMenuText(['STARTERS', 'Paneer Tikka 320', 'Taxes extra as applicable', 'GST 5%'].join('\n'));

      expect(draft.categories.map((category) => category.name)).toEqual(['STARTERS']);
      expect(names(draft)).toEqual(['Paneer Tikka']);
      expect(draft.issues.map((issue) => issue.line)).toEqual(['Taxes extra as applicable', 'GST 5%']);
    });

    it('ignores separator rows without calling them issues', () => {
      const draft = parseMenuText(['STARTERS', '-----', 'Paneer Tikka 320', '===='].join('\n'));

      expect(names(draft)).toEqual(['Paneer Tikka']);
      expect(draft.issues).toEqual([]);
    });
  });

  describe('half / full pricing', () => {
    it('turns printed portions into real variants with an honest entry price', () => {
      const draft = parseMenuText('Butter Chicken Half 240 Full 420');
      const item = draft.categories[0].items[0];

      expect(item.name).toBe('Butter Chicken');
      // The dish's own price is the smallest portion — the entry price.
      expect(item.pricePaise).toBe(24000);
      expect(item.variants).toEqual([
        { name: 'Half', pricePaise: 24000 },
        { name: 'Full', pricePaise: 42000 },
      ]);
      // The line was understood: nothing for the owner to fix.
      expect(draft.issues).toEqual([]);
    });

    it('keeps separators out of the dish name when the line prints slashes', () => {
      const draft = parseMenuText('Butter Chicken Half 240 / Full 420');
      expect(draft.categories[0].items[0].name).toBe('Butter Chicken');
    });

    it('reports a double price it cannot split instead of guessing the portions', () => {
      const draft = parseMenuText('Paneer Half 240 / 420');
      const item = draft.categories[0].items[0];

      expect(item.name).toBe('Paneer');
      expect(item.pricePaise).toBe(42000);
      expect(item.variants).toBeUndefined();
      expect(draft.issues[0].reason).toMatch(/variant/i);
    });
  });

  describe('veg marking', () => {
    it('marks named meat as non-veg and leaves everything else unmarked', () => {
      const draft = parseMenuText(['Chicken 65 360', 'Paneer Tikka 320', 'Egg Curry 240', 'Fish Fry 400'].join('\n'));
      const byName = Object.fromEntries(
        draft.categories[0].items.map((item) => [item.name, item.isVeg]),
      );

      expect(byName['Chicken 65']).toBe(false);
      // The menu never marked it, so AutoDine does not either.
      expect(byName['Paneer Tikka']).toBeNull();
      expect(byName['Egg Curry']).toBe(false);
      expect(byName['Fish Fry']).toBe(false);
    });

    it('uses a bracketed marker after the price over the name guess', () => {
      const draft = parseMenuText(['Chicken 65 360 (V)', 'Paneer Tikka 320 (N)'].join('\n'));
      const byName = Object.fromEntries(
        draft.categories[0].items.map((item) => [item.name, item.isVeg]),
      );

      expect(byName['Chicken 65']).toBe(true);
      expect(byName['Paneer Tikka']).toBe(false);
    });
  });

  describe('duplicates and caps', () => {
    it('drops an exact repeated line but counts it', () => {
      const draft = parseMenuText(['STARTERS', 'Paneer Tikka 320', 'Paneer Tikka 320'].join('\n'));

      expect(names(draft)).toEqual(['Paneer Tikka']);
      expect(draft.duplicates).toBe(1);
    });

    it('keeps the same dish at two prices, because that is a variant', () => {
      const draft = parseMenuText(['STARTERS', 'Paneer Tikka 320', 'Paneer Tikka 380'].join('\n'));

      expect(names(draft)).toEqual(['Paneer Tikka', 'Paneer Tikka']);
      expect(draft.duplicates).toBe(0);
    });

    it('stops at the dish cap and says why', () => {
      const lines = Array.from({ length: MAX_IMPORT_ITEMS + 20 }, (_, index) => `Dish ${index + 1} ${100 + index}`);
      const draft = parseMenuText(lines.join('\n'));

      expect(draftItemCount(draft)).toBe(MAX_IMPORT_ITEMS);
      expect(draft.issues.at(-1)?.reason).toMatch(/split the paste/i);
    });

    it('refuses a paste with absurdly many sections', () => {
      const lines = Array.from({ length: MAX_IMPORT_CATEGORIES + 5 }, () => 'STARTERS');
      const draft = parseMenuText(lines.join('\n'));

      expect(draft.categories).toEqual([]);
      expect(draft.issues[0].reason).toMatch(/split the paste/i);
    });
  });

  it('returns an empty draft for blank text rather than inventing a dish', () => {
    const draft = parseMenuText('\n\n   \n');
    expect(draft.categories).toEqual([]);
    expect(draftItemCount(draft)).toBe(0);
  });
});



/**
 * The row mapping is the part that decides what an owner's spreadsheet means
 * -- it is tested as pure text. The spreadsheet library itself is a thin
 * wrapper (mocked below), because the rules that matter here are the ones
 * lib/menu-import.ts already enforces for every other source: never a free
 * dish, never an invented veg mark.
 */

describe('parseVegCell', () => {
  it('reads the mark, the non-mark, and refuses to guess', () => {
    expect(parseVegCell('Veg')).toBe(true);
    expect(parseVegCell('v')).toBe(true);
    expect(parseVegCell('yes')).toBe(true);
    expect(parseVegCell('Non-veg')).toBe(false);
    expect(parseVegCell('n')).toBe(false);
    expect(parseVegCell('false')).toBe(false);
    expect(parseVegCell('')).toBeNull();
    expect(parseVegCell('  ')).toBeNull();
    expect(parseVegCell('maybe')).toBeNull();
  });
});

describe('rowsToDraft', () => {
  const header = ['Category', 'Name', 'Price', 'Description', 'Veg'];

  it('maps rows to dishes with forward-filled categories', () => {
    const draft = rowsToDraft([
      header,
      ['Starters', 'Paneer Tikka', '320', 'Clay oven', 'Veg'],
      ['', 'Chicken 65', '360', '', 'Non-veg'],
      ['Main', 'Dal Makhani', '₹280', '', ''],
    ]);

    expect(draft.categories.map((c) => c.name)).toEqual(['Starters', 'Main']);
    expect(draft.categories[0].items.map((i) => i.name)).toEqual(['Paneer Tikka', 'Chicken 65']);
    expect(draft.categories[0].items[0]).toMatchObject({
      pricePaise: 32000,
      description: 'Clay oven',
      isVeg: true,
    });
    expect(draft.categories[0].items[1].isVeg).toBe(false);
    // A blank veg cell is unmarked — never vegetarian.
    expect(draft.categories[1].items[0].isVeg).toBeNull();
    expect(draft.categories[1].items[0].pricePaise).toBe(28000);
    expect(draft.issues).toEqual([]);
  });

  it('reports a row without a price instead of importing it free', () => {
    const draft = rowsToDraft([header, ['Starters', 'Paneer Tikka', '', '', '']]);

    expect(draft.categories).toEqual([]);
    expect(draft.issues).toHaveLength(1);
    expect(draft.issues[0].reason).toContain('No price');
    expect(draft.issues[0].line).toContain('Paneer Tikka');
  });

  it('reports an unreadable price instead of rounding it into being', () => {
    const draft = rowsToDraft([header, ['S', 'Paneer', 'two-fifty', '', '']]);
    expect(draft.categories).toEqual([]);
    expect(draft.issues[0].reason).toContain('could not be read');
  });

  it('skips a nameless row with its text kept for the owner', () => {
    const draft = rowsToDraft([header, ['S', '', '200', '', '']]);
    expect(draft.categories).toEqual([]);
    expect(draft.issues[0].reason).toContain('no dish name');
  });

  it('drops a duplicate dish with the same name and price in the same section', () => {
    const draft = rowsToDraft([
      header,
      ['S', 'Paneer', '200', '', ''],
      ['S', 'Paneer', '200', '', ''],
    ]);
    expect(draft.categories[0].items).toHaveLength(1);
    expect(draft.duplicates).toBe(1);
  });

  it('explains itself when there is no name column at all', () => {
    const draft = rowsToDraft([['a', 'b'], ['1', '2']]);
    expect(draft.categories).toEqual([]);
    expect(draft.issues[0].reason).toContain('dish-name column');
  });

  it('explains itself when the name column exists but no price column does', () => {
    const draft = rowsToDraft([['Name', 'Cost to us'], ['Paneer', '120']]);
    expect(draft.categories).toEqual([]);
    expect(draft.issues[0].reason).toContain('price column');
  });

  it('takes the first sheet as a menu even when the header is not the first row', () => {
    const draft = rowsToDraft([
      ['My Restaurant Menu', '', ''],
      ['', '', ''],
      ['Category', 'Name', 'Price'],
      ['S', 'Paneer', '200'],
    ]);
    expect(draft.categories[0].items[0].name).toBe('Paneer');
  });
});

describe('parseCsvRows', () => {
  it('reads quoted fields with commas, quotes and newlines in them', () => {
    const rows = parseCsvRows('name,price\n"Paneer, Tikka","200"\n"He said ""hi""","300"\n"a\nb",400\n');
    expect(rows[1]).toEqual(['Paneer, Tikka', '200']);
    expect(rows[2]).toEqual(['He said "hi"', '300']);
    expect(rows[3]).toEqual(['a\nb', '400']);
  });

  it('tolerates CRLF and a leading BOM', () => {
    const rows = parseCsvRows('\uFEFFname,price\r\nDal,200\r\n');
    expect(rows[0]).toEqual(['name', 'price']);
    expect(rows[1]).toEqual(['Dal', '200']);
  });
});

describe('parseMenuCsv', () => {
  it('turns a plain CSV into a draft through the same rules', () => {
    const draft = parseMenuCsv('category,name,price,veg\nStarters,Paneer Tikka,320,Veg\nStarters,Dal,280,\n');
    expect(draft.categories).toHaveLength(1);
    expect(draft.categories[0].items).toHaveLength(2);
    expect(draft.categories[0].items[1].isVeg).toBeNull();
  });
});

describe('parseMenuXlsx', () => {
  it('flattens spreadsheet cells to text and hands them to the same mapping', async () => {
    vi.resetModules();
    vi.doMock('read-excel-file/node', () => ({
      // v9 shape: every sheet is { sheet, data }; only the first is read.
      default: async () => [
        {
          sheet: 'Menu',
          data: [
            ['Category', 'Name', 'Price', 'Veg'],
            ['Starters', 'Paneer', 320, true],
            ['Starters', 'Dal', 280, null],
          ],
        },
      ],
    }));

    const { parseMenuXlsx } = await import('./bulk-parse');
    const draft = await parseMenuXlsx(Buffer.from('fake'));

    expect(draft.categories[0].items[0]).toMatchObject({ name: 'Paneer', pricePaise: 32000, isVeg: true });
    expect(draft.categories[0].items[1].isVeg).toBeNull();

    vi.doUnmock('read-excel-file/node');
    vi.resetModules();
  });
});
