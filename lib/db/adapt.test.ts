import { describe, expect, it } from 'vitest';
import { rupeesToPaise } from '@/lib/money';
import type { Category, MenuItem, Restaurant } from './types';
import {
  toDisplayCategories,
  toDisplayItem,
  toDisplayMenu,
  toDisplayRestaurant,
} from './adapt';

const restaurant: Restaurant = {
  id: 'r-1',
  slug: 'saffron-smoke',
  name: 'Saffron & Smoke',
  tagline: 'Modern Indian kitchen',
  address: '14 Civil Lines',
  phone: '+91 712 000 0000',
  gstin: '22AAAAA0000A1Z5',
  timezone: 'Asia/Kolkata',
  tax_rate_bps: 500,
  is_active: true,
  announcement_text: null,
  announcement_on: false,
  logo_path: null,
  banner_path: null,
  accent: 'forest',
  updated_at: '2026-10-19T00:00:00Z',
  created_at: '2026-10-19T00:00:00Z',
};

function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 'i-1',
    restaurant_id: 'r-1',
    category_id: 'c-1',
    name: 'Paneer Tikka',
    description: 'Charred cottage cheese',
    price_paise: 34900,
    is_veg: true,
    is_available: true,
    image_url: null,
    sort_order: 0,
    variants: [],
    ...overrides,
  };
}

describe('toDisplayItem', () => {
  it('converts paise to rupees', () => {
    expect(toDisplayItem(item({ price_paise: 34900 })).price).toBe(349);
  });

  it('converts fractional paise without losing the paisa', () => {
    expect(toDisplayItem(item({ price_paise: 34950 })).price).toBe(349.5);
  });

  it('round-trips back to the exact original paise', () => {
    // The cart calls rupeesToPaise(i.price). If the display conversion lost
    // precision, every total would drift by a paisa or two.
    for (const paise of [0, 1, 99, 100, 34900, 34950, 123456]) {
      expect(rupeesToPaise(toDisplayItem(item({ price_paise: paise })).price)).toBe(paise);
    }
  });

  it('renames the description and boolean fields', () => {
    const out = toDisplayItem(
      item({ description: 'Smoky', is_veg: false, is_available: false })
    );
    expect(out.desc).toBe('Smoky');
    expect(out.veg).toBe(false);
    expect(out.available).toBe(false);
  });

  it('drops a null description to an empty string rather than "null"', () => {
    expect(toDisplayItem(item({ description: null })).desc).toBe('');
  });

  it('omits img entirely when there is no image', () => {
    const out = toDisplayItem(item({ image_url: null }));
    expect(out.img).toBeUndefined();
    expect('img' in out).toBe(false);
  });

  it('keeps img when there is one', () => {
    expect(toDisplayItem(item({ image_url: '/img/x.jpg' })).img).toBe('/img/x.jpg');
  });

  it('omits variants when there are none', () => {
    const out = toDisplayItem(item({ variants: [] }));
    expect(out.variants).toBeUndefined();
    expect('variants' in out).toBe(false);
  });

  it('maps variants, converting each price to rupees', () => {
    const out = toDisplayItem(
      item({
        variants: [
          { id: 'v-1', item_id: 'i-1', name: 'Half', price_paise: 34900, sort_order: 0 },
          { id: 'v-2', item_id: 'i-1', name: 'Full', price_paise: 64900, sort_order: 1 },
        ],
      })
    );
    expect(out.variants).toEqual([
      { id: 'v-1', name: 'Half', price: 349 },
      { id: 'v-2', name: 'Full', price: 649 },
    ]);
  });

  it('falls back to the "all" tab for an item with no category', () => {
    // Without this the dish would render under a category id that has no tab
    // and be unreachable.
    expect(toDisplayItem(item({ category_id: null })).category).toBe('all');
  });
});

describe('toDisplayCategories', () => {
  const cats: Category[] = [
    { id: 'c-1', restaurant_id: 'r-1', menu_id: 'm-1', name: 'Starters', sort_order: 0 },
    { id: 'c-2', restaurant_id: 'r-1', menu_id: 'm-1', name: 'Breads', sort_order: 1 },
  ];

  it('counts items per category', () => {
    const items = [
      item({ id: 'a', category_id: 'c-1' }),
      item({ id: 'b', category_id: 'c-1' }),
      item({ id: 'c', category_id: 'c-2' }),
    ];
    expect(toDisplayCategories(cats, items)).toEqual([
      { id: 'c-1', name: 'Starters', count: 2 },
      { id: 'c-2', name: 'Breads', count: 1 },
    ]);
  });

  it('reports zero for an empty category instead of dropping it', () => {
    expect(toDisplayCategories(cats, [])).toEqual([
      { id: 'c-1', name: 'Starters', count: 0 },
      { id: 'c-2', name: 'Breads', count: 0 },
    ]);
  });

  it('does not count uncategorised items toward any category', () => {
    const out = toDisplayCategories(cats, [item({ category_id: null })]);
    expect(out.every((c) => c.count === 0)).toBe(true);
  });
});

describe('toDisplayRestaurant', () => {
  it('passes through the columns that exist', () => {
    const out = toDisplayRestaurant(restaurant);
    expect(out.name).toBe('Saffron & Smoke');
    expect(out.gstin).toBe('22AAAAA0000A1Z5');
    expect(out.timezone).toBe('Asia/Kolkata');
  });

  it('substitutes a visible placeholder for the columns the schema has not caught up with', () => {
    const out = toDisplayRestaurant({ ...restaurant, tagline: null });
    // FSSAI and opening hours are not columns yet, so the display layer says
    // so out loud rather than printing a blank where a value should be.
    expect(out.fssai).toBe('FSSAI — add in Settings');
    expect(out.openHours).toBe('Hours — add in Settings');
    expect(out.tagline).toBe('');
  });

  it('leaves a GSTIN it was never given blank, and invents nothing', () => {
    // A GSTIN is private: it is not in the public storefront projection at
    // all, so a restaurant read for a guest arrives without one. Blank is the
    // honest answer. A placeholder here would be worse than blank for two
    // reasons: it tells a stranger that a GSTIN exists to be fetched, and it
    // points a guest at a Settings screen only staff can reach. The printed
    // bill is a staff document and reads the number from the tenant row
    // itself (lib/db/bill.ts), not through this adapter.
    const out = toDisplayRestaurant({ ...restaurant, gstin: null });
    expect(out.gstin).toBe('');
    expect(out.gstin).not.toContain('GSTIN');
  });
});

describe('toDisplayMenu', () => {
  it('adapts a whole menu in one call', () => {
    const out = toDisplayMenu({
      restaurant,
      menu: { id: 'm-1', restaurant_id: 'r-1', name: 'Main', is_published: true, sort_order: 0 },
      menus: [{ id: 'm-1', name: 'Main' }],
      categories: [{ id: 'c-1', restaurant_id: 'r-1', menu_id: 'm-1', name: 'Starters', sort_order: 0 }],
      items: [item()],
    });
    expect(out.restaurant.name).toBe('Saffron & Smoke');
    expect(out.categories).toHaveLength(1);
    expect(out.items[0].price).toBe(349);
  });

  it('carries the menu tabs and which one is showing', () => {
    const out = toDisplayMenu({
      restaurant,
      menu: { id: 'm-2', restaurant_id: 'r-1', name: 'Dinner', is_published: true, sort_order: 1 },
      menus: [
        { id: 'm-1', name: 'Breakfast' },
        { id: 'm-2', name: 'Dinner' },
      ],
      categories: [{ id: 'c-9', restaurant_id: 'r-1', menu_id: 'm-2', name: 'Mains', sort_order: 0 }],
      items: [{ ...item(), id: 'i-9', category_id: 'c-9' }],
    });

    // Both tabs reach the screen, and the one being shown is named, so the
    // subtitle can say "Dinner" rather than guessing from the first tab.
    expect(out.menus.map((menu) => menu.name)).toEqual(['Breakfast', 'Dinner']);
    expect(out.menuId).toBe('m-2');
    expect(out.menuName).toBe('Dinner');
  });
});
