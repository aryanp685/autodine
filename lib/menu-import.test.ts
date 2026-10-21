import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_CATEGORIES,
  MAX_IMPORT_ITEMS,
  draftItemCount,
  draftFromAiAnswer,
  parseMenuText,
  parsePriceToPaise,
  sanitiseDraft,
} from './menu-import';

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
    it('uses the last price so the dish is not free, and says so', () => {
      const draft = parseMenuText('Butter Chicken Half 240 Full 420');
      const item = draft.categories[0].items[0];

      expect(item.name).toBe('Butter Chicken');
      expect(item.pricePaise).toBe(42000);
      expect(draft.issues[0].reason).toMatch(/variant/i);
    });
  });

  describe('veg marking', () => {
    it('marks named meat as non-veg and everything else as veg', () => {
      const draft = parseMenuText(['Chicken 65 360', 'Paneer Tikka 320', 'Egg Curry 240', 'Fish Fry 400'].join('\n'));
      const byName = Object.fromEntries(
        draft.categories[0].items.map((item) => [item.name, item.isVeg]),
      );

      expect(byName['Chicken 65']).toBe(false);
      expect(byName['Paneer Tikka']).toBe(true);
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

describe('sanitiseDraft', () => {
  const valid = {
    name: 'Starters',
    items: [
      { name: 'Paneer Tikka', pricePaise: 32000, isVeg: true, description: null },
      { name: 'Chicken 65', pricePaise: 36000, isVeg: false, description: 'Spicy' },
    ],
  };

  it('accepts a draft the review screen posted back', () => {
    const draft = sanitiseDraft({ categories: [valid] });

    expect(draft.categories[0].name).toBe('Starters');
    expect(draftItemCount(draft)).toBe(2);
  });

  it('drops dishes whose price is zero, negative or not a number', () => {
    const draft = sanitiseDraft({
      categories: [
        {
          name: 'Starters',
          items: [
            { name: 'Free water', pricePaise: 0 },
            { name: 'Refund', pricePaise: -100 },
            { name: 'Text price', pricePaise: '320' },
            { name: 'Paneer Tikka', pricePaise: 32000 },
          ],
        },
      ],
    });

    expect(draft.categories[0].items.map((item) => item.name)).toEqual(['Paneer Tikka']);
  });

  it('drops nameless dishes and nameless sections', () => {
    const draft = sanitiseDraft({
      categories: [
        { name: '   ', items: valid.items },
        { name: 'Starters', items: [{ name: '  ', pricePaise: 100 }, ...valid.items] },
      ],
    });

    expect(draft.categories.map((category) => category.name)).toEqual(['Starters']);
    expect(draftItemCount(draft)).toBe(2);
  });

  it('drops a section that ends up with no dishes', () => {
    const draft = sanitiseDraft({ categories: [{ name: 'Empty', items: [] }] });
    expect(draft.categories).toEqual([]);
  });

  it('caps sections and dishes, and truncates long text', () => {
    const categories = Array.from({ length: MAX_IMPORT_CATEGORIES + 5 }, (_, index) => ({
      name: `Section ${index}`,
      items: [{ name: 'X'.repeat(500), pricePaise: 100 }],
    }));
    const draft = sanitiseDraft({ categories });

    expect(draft.categories.length).toBe(MAX_IMPORT_CATEGORIES);
    expect(draft.categories[0].items[0].name.length).toBe(120);
    expect(draft.categories[0].name.length).toBeLessThanOrEqual(60);
  });

  it('never throws on junk from the browser', () => {
    for (const junk of [null, undefined, 42, 'menu', [], { categories: 'nope' }, { categories: [null, 7] }]) {
      expect(sanitiseDraft(junk).categories).toEqual([]);
    }
  });

  it('assumes veg when the flag is missing, matching the editor default', () => {
    const draft = sanitiseDraft({ categories: [{ name: 'S', items: [{ name: 'Dal', pricePaise: 20000 }] }] });
    expect(draft.categories[0].items[0].isVeg).toBe(true);
  });
});

describe('draftFromAiAnswer', () => {
  it('converts the model’s rupees to paise and keeps its veg call', () => {
    const draft = draftFromAiAnswer({
      categories: [
        { name: 'Starters', items: [{ name: 'Chicken 65', price: 360, isVeg: false }] },
      ],
    });

    expect(draft.categories[0].items[0].pricePaise).toBe(36000);
    expect(draft.categories[0].items[0].isVeg).toBe(false);
  });

  it('drops a malformed row instead of writing it', () => {
    const draft = draftFromAiAnswer({
      categories: [{ name: 'Starters', items: [{ name: 'Paneer Tikka', price: 'lots' }, { name: 'Dal', price: 280 }] }],
    });

    expect(draft.categories[0].items.map((item) => item.name)).toEqual(['Dal']);
  });

  it('returns an empty draft for an answer that is not a menu', () => {
    expect(draftFromAiAnswer({ text: 'sorry' }).categories).toEqual([]);
    expect(draftFromAiAnswer(null).categories).toEqual([]);
  });
});
