import { describe, expect, it } from 'vitest';
import { buildVisionDraft, validateMenuCapture } from './menu-vision';

/**
 * These tests exist because the danger in this feature is not a crash -- it is
 * a plausible-looking wrong price that nobody re-reads. Every case below is a
 * way the model can produce one.
 */

const draft = (answer: unknown) => buildVisionDraft(answer, 'test-model');

describe('buildVisionDraft', () => {
  it('keeps a clean read intact', () => {
    const result = draft({
      categories: [
        {
          name: 'Starters',
          items: [
            {
              name: 'Paneer Tikka',
              price: 320,
              priceConfidence: 'high',
              isVeg: true,
              vegConfidence: 'high',
              description: null,
              photo: { page: 1, x: 100, y: 200, w: 100, h: 100 },
            },
          ],
        },
      ],
    });

    expect(result.itemCount).toBe(1);
    expect(result.flaggedCount).toBe(0);
    expect(result.categories[0].items[0]).toMatchObject({
      name: 'Paneer Tikka',
      pricePaise: 32000,
      isVeg: true,
      flags: [],
    });
    expect(result.categories[0].items[0].photo).toEqual({ page: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.1 });
  });

  it('NEVER invents a price', () => {
    const result = draft({
      categories: [
        {
          name: 'Starters',
          items: [
            // null price: the print was covered.
            { name: 'Paneer Tikka', price: null, priceConfidence: 'low', isVeg: true },
            // zero is not a price, it is a reading failure.
            { name: 'Dal Makhani', price: 0, priceConfidence: 'high', isVeg: true },
            // a number the model itself is unsure about
            { name: 'Chicken 65', price: 249, priceConfidence: 'low', isVeg: false },
            // and a string where a number belongs
            { name: 'Naan', price: '₹60', priceConfidence: 'high', isVeg: true },
          ],
        },
      ],
    });

    for (const item of result.categories[0].items) {
      expect(item.pricePaise, `${item.name} must not carry a guessed price`).toBeNull();
    }
    expect(result.flaggedCount).toBe(4);
  });

  it('flags a low-confidence price even when the number looks sane', () => {
    const result = draft({
      categories: [{ name: 'A', items: [{ name: 'Kebab', price: 300, priceConfidence: 'low' }] }],
    });
    expect(result.categories[0].items[0].pricePaise).toBeNull();
    expect(result.categories[0].items[0].flags).toContain('price-unclear');
  });

  it('omits a dish with no readable name instead of naming it', () => {
    const result = draft({
      categories: [{ name: 'Starters', items: [{ name: '   ', price: 100 }, { name: 'Dal', price: 200 }] }],
    });
    expect(result.categories[0].items).toHaveLength(1);
    expect(result.categories[0].items[0].name).toBe('Dal');
  });

  it('keeps an unreadable dietary mark as unknown rather than defaulting to veg', () => {
    const result = draft({
      categories: [{ name: 'A', items: [{ name: 'Mystery Roll', price: 90, isVeg: null }] }],
    });
    expect(result.categories[0].items[0].isVeg).toBeNull();
    expect(result.categories[0].items[0].flags).toContain('veg-unclear');
  });

  it('drops a degenerate or out-of-frame photo box', () => {
    const result = draft({
      categories: [
        {
          name: 'A',
          items: [
            { name: 'A', price: 10, photo: { page: 1, x: 0.9, y: 0.9, w: 0.5, h: 0.5 } },
            { name: 'B', price: 10, photo: { page: 1, x: 5, y: 5, w: 0, h: 0 } },
            { name: 'C', price: 10, photo: 'nonsense' },
          ],
        },
      ],
    });
    for (const item of result.categories[0].items) expect(item.photo).toBeNull();
  });

  it('survives nonsense without throwing', () => {
    for (const junk of [null, undefined, 42, 'menu', [], { categories: 'no' }, { categories: [{}] }]) {
      const result = draft(junk);
      expect(result.categories).toEqual([]);
      expect(result.itemCount).toBe(0);
    }
  });

  it('keeps the model notes so a rotated page is visible to the owner', () => {
    const result = draft({ categories: [], notes: ['page 2 was upside down', 12, ''] });
    expect(result.notes).toEqual(['page 2 was upside down']);
  });
});

describe('validateMenuCapture', () => {
  it('accepts the four supported types', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      expect(validateMenuCapture({ size: 1000, type }).ok).toBe(true);
    }
  });

  it('falls back to the extension when the browser sends no type', () => {
    expect(validateMenuCapture({ size: 1000, type: '', name: 'menu.pdf' })).toEqual({
      ok: true,
      mimeType: 'application/pdf',
    });
  });

  it('refuses an unsupported type and an oversized file with distinct messages', () => {
    const svg = validateMenuCapture({ size: 100, type: 'image/svg+xml' });
    expect(svg.ok).toBe(false);
    expect(svg.ok === false && svg.code).toBe('bad-file');

    const big = validateMenuCapture({ size: 9 * 1024 * 1024, type: 'image/jpeg' });
    expect(big.ok).toBe(false);
    expect(big.ok === false && big.code).toBe('too-large');
  });
});
