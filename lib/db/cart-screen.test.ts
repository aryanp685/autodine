import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(async () => null as unknown),
}));

vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: true }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { getCartScreenData } from './cart-screen';

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type TableResults = Record<
  'restaurants' | 'menus' | 'categories' | 'items' | 'item_addon_groups' | 'item_addons',
  QueryResult
>;

const BASE_RESULTS: TableResults = {
  restaurants: {
    data: {
      id: 'restaurant-1',
      name: 'Saffron Smoke',
      slug: 'saffron-smoke',
      tax_rate_bps: 0,
      is_active: true,
      brand_theme_enabled: false,
      brand_theme: null,
    },
    error: null,
  },
  menus: { data: [{ id: 'menu-1' }], error: null },
  categories: { data: [{ id: 'category-1' }], error: null },
  items: {
    data: [
      {
        id: 'item-1',
        name: 'Paneer Tikka',
        price_paise: 34900,
        is_veg: true,
        is_available: true,
        image_url: null,
        item_variants: [],
      },
    ],
    error: null,
  },
  item_addon_groups: {
    data: [{ id: 'group-1', item_id: 'item-1', max_select: 2 }],
    error: null,
  },
  item_addons: {
    data: [{ id: 'addon-1', group_id: 'group-1', name: 'Extra cheese', price_paise: 500 }],
    error: null,
  },
};

const GST_RESULTS: Record<string, QueryResult> = {
  off: { data: { mode: 'off', rate_bps: null }, error: null },
  composition: { data: { mode: 'composition', rate_bps: null }, error: null },
  regular: { data: { mode: 'regular', rate_bps: 500 }, error: null },
};

function fakeSupabase(results: TableResults, gstMode: keyof typeof GST_RESULTS = 'off') {
  const queriedTables: string[] = [];
  const client = {
    rpc(functionName: string) {
      if (functionName === 'public_restaurant_profile') {
        return { maybeSingle: () => Promise.resolve({ data: results.restaurants.data, error: results.restaurants.error }) };
      }
      if (functionName === 'public_restaurant_gst') {
        return { maybeSingle: () => Promise.resolve(GST_RESULTS[gstMode]) };
      }
      throw new Error(`Unexpected RPC: ${functionName}`);
    },
    from(table: keyof TableResults) {
      queriedTables.push(table);
      const result = results[table] ?? { data: [], error: null };
      const promise = Promise.resolve(result);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.order = () => chain;
      chain.maybeSingle = () => promise;
      chain.then = promise.then.bind(promise);
      return chain;
    },
  };

  return { client, queriedTables };
}

function useResults(
  overrides: Partial<TableResults> = {},
  gstMode: keyof typeof GST_RESULTS = 'off'
) {
  const fake = fakeSupabase({ ...BASE_RESULTS, ...overrides }, gstMode);
  mocks.createClient.mockResolvedValue(fake.client);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cart screen pricing reads', () => {
  it('includes authoritative add-on prices when all pricing reads succeed', async () => {
    useResults();

    const data = await getCartScreenData('saffron-smoke');

    expect(data?.items[0].addons).toEqual([
      {
        id: 'addon-1',
        name: 'Extra cheese',
        pricePaise: 500,
        groupId: 'group-1',
        maxSelect: 2,
      },
    ]);
  });

  it('prices an off-mode quote with the restaurant rate', async () => {
    useResults({
      restaurants: {
        data: { ...(BASE_RESULTS.restaurants.data as Record<string, unknown>), tax_rate_bps: 500 },
        error: null,
      },
    }, 'off');

    const data = await getCartScreenData('saffron-smoke');

    expect(data?.gst).toEqual({ mode: 'off', rateBps: 500 });
  });

  it('prices a composition quote with no rate', async () => {
    useResults({}, 'composition');

    const data = await getCartScreenData('saffron-smoke');

    expect(data?.gst).toEqual({ mode: 'composition', rateBps: null });
  });

  it('prices a regular quote with the profile rate from the public projection', async () => {
    useResults({}, 'regular');

    const data = await getCartScreenData('saffron-smoke');

    expect(data?.gst).toEqual({ mode: 'regular', rateBps: 500 });
  });

  it.each(['item_addon_groups', 'item_addons'])(
    'fails closed rather than returning a lower quote when the %s read fails',
    async (table) => {
      useResults({
        [table]: {
          data: null,
          error: { code: '42501', message: `permission denied for table ${table}` },
        },
      });

      await expect(getCartScreenData('saffron-smoke')).rejects.toMatchObject({
        message: 'Could not load add-on pricing. Please try again.',
      });
    },
  );
});
