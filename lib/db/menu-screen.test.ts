import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The network layer is mocked rather than the client: menu reads go through
 * `getRestaurantMenu` → `readPublicRestaurant` and the supabase-js builder,
 * and the mapping under test here is what getMenuScreenData wraps around it.
 * SQL semantics (the published/active filters, RLS on the public projection)
 * are enforced by Postgres and need a real database, which this sandbox does
 * not have.
 */

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: { value: true as boolean },
  getRestaurantMenu: { result: null as unknown },
}));

vi.mock('@/lib/supabase/env', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured.value,
}));

vi.mock('./menu', () => ({
  getRestaurantMenu: () => Promise.resolve(mocks.getRestaurantMenu.result),
}));

import { getMenuScreenData } from './menu-screen';

type Row = Record<string, unknown>;

/** A minimal published menu + categories + items, as toDisplayMenu expects. */
function menuData(overrides: Partial<Row> = {}) {
  return {
    restaurant: { id: 'r-1', slug: 'saffron', name: 'Saffron & Smoke', is_active: true },
    menu: { id: 'm-1', name: 'Dinner' },
    menus: [{ id: 'm-1', name: 'Dinner' }],
    categories: [{ id: 'c-1', name: 'Mains', sort_order: 0 }],
    items: [
      {
        id: 'i-1',
        category_id: 'c-1',
        name: 'Butter Chicken',
        price_paise: 32000,
        is_available: true,
        item_variants: [],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.isSupabaseConfigured.value = true;
  mocks.getRestaurantMenu.result = null;
});

describe('getMenuScreenData', () => {
  it('returns null when Supabase is not configured (screen keeps its demo content)', async () => {
    mocks.isSupabaseConfigured.value = false;
    await expect(getMenuScreenData('saffron')).resolves.toBeNull();
  });

  it('returns null when no slug is given (callers decide what bare /menu means)', async () => {
    await expect(getMenuScreenData()).resolves.toBeNull();
  });

  it('returns null for a blank slug', async () => {
    await expect(getMenuScreenData('   ')).resolves.toBeNull();
  });

  it('returns null when the restaurant or menu does not exist', async () => {
    mocks.getRestaurantMenu.result = null;
    await expect(getMenuScreenData('saffron')).resolves.toBeNull();
  });

  it('maps a loaded menu through toDisplayMenu', async () => {
    mocks.getRestaurantMenu.result = menuData();
    const data = await getMenuScreenData('saffron');
    expect(data).not.toBeNull();
    expect(data?.restaurant.name).toBe('Saffron & Smoke');
    expect(data?.menuId).toBe('m-1');
    expect(data?.menuName).toBe('Dinner');
    expect(data?.items[0]?.name).toBe('Butter Chicken');
    expect(data?.menus).toHaveLength(1);
  });

  it('rethrows a real query failure instead of serving demo content', async () => {
    mocks.getRestaurantMenu.result = Promise.reject(new Error('network down'));
    await expect(getMenuScreenData('saffron')).rejects.toThrow('network down');
  });
});
