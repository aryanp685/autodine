import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_CATEGORIES, sanitiseDraft } from './menu-import';

/**
 * The sanitiser is the gate every draft passes through before anything is
 * written, whatever produced it. What these pin: nothing free, nothing
 * nameless, nothing invented — and the three-state veg mark survives the
 * browser round trip uncoerced.
 */

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
    expect(draft.categories[0].items).toHaveLength(2);
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
    expect(draft.categories[0].items).toHaveLength(2);
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

  it('keeps an unmarked dish unmarked when the flag is missing', () => {
    const draft = sanitiseDraft({ categories: [{ name: 'S', items: [{ name: 'Dal', pricePaise: 20000 }] }] });
    expect(draft.categories[0].items[0].isVeg).toBeNull();
  });

  it('round-trips all three veg states without coercing any of them', () => {
    const draft = sanitiseDraft({
      categories: [
        {
          name: 'S',
          items: [
            { name: 'A', pricePaise: 100, isVeg: true },
            { name: 'B', pricePaise: 100, isVeg: false },
            { name: 'C', pricePaise: 100, isVeg: null },
            { name: 'D', pricePaise: 100, isVeg: 'nonsense' },
          ],
        },
      ],
    });
    const states = draft.categories[0].items.map((item) => item.isVeg);
    expect(states).toEqual([true, false, null, null]);
  });

  it('keeps real portions and drops malformed ones', () => {
    const draft = sanitiseDraft({
      categories: [
        {
          name: 'S',
          items: [
            {
              name: 'Butter Chicken',
              pricePaise: 24000,
              variants: [
                { name: 'Half', pricePaise: 24000 },
                { name: 'Full', pricePaise: 42000 },
                { name: '', pricePaise: 100 },
                { name: 'Free', pricePaise: 0 },
                'junk',
              ],
            },
            { name: 'Dal', pricePaise: 20000, variants: 'nope' },
          ],
        },
      ],
    });

    expect(draft.categories[0].items[0].variants).toEqual([
      { name: 'Half', pricePaise: 24000 },
      { name: 'Full', pricePaise: 42000 },
    ]);
    // A dish with no portions has no variants key at all.
    expect(draft.categories[0].items[1].variants).toBeUndefined();
  });
});
