import { describe, expect, it, vi } from 'vitest';
import { parseCsvRows, parseMenuCsv, parseVegCell, rowsToDraft } from './menu-import-file';

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

    const { parseMenuXlsx } = await import('./menu-import-file');
    const draft = await parseMenuXlsx(Buffer.from('fake'));

    expect(draft.categories[0].items[0]).toMatchObject({ name: 'Paneer', pricePaise: 32000, isVeg: true });
    expect(draft.categories[0].items[1].isVeg).toBeNull();

    vi.doUnmock('read-excel-file/node');
    vi.resetModules();
  });
});
