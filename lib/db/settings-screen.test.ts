import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The supabase client is mocked rather than the network. The logic under test
 * is the loader's own: who may edit, the missing-column (42703) retry for the
 * guest verification mode, the difference between a failed read (throw) and a
 * missing restaurant (blocked), and the derived menu/QR numbers the screen
 * prints on the standee. The SQL scoping is enforced by Postgres and covered
 * by the database integration suite.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  staff: { value: null as unknown },
  origin: { value: 'https://new-alpha-five-43.vercel.app' },
  svg: { value: '<svg/>' as string | null },
  gst: { value: null as unknown },
  printers: { value: [] as unknown[] },
}));

vi.mock('./staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.value),
}));

vi.mock('./gst-settings', () => ({
  loadGstSettings: () => Promise.resolve(mocks.gst.value),
  NOT_READY: { ready: false, mode: 'off' },
}));

vi.mock('./printers', () => ({
  loadRestaurantPrinters: () => Promise.resolve(mocks.printers.value),
}));

vi.mock('../qr', () => ({
  siteOrigin: () => Promise.resolve(mocks.origin.value),
  qrSvg: () => Promise.resolve(mocks.svg.value),
}));

import { getSettingsScreenData } from './settings-screen';

/** Chainable builder good enough for the reads in the loader. */
function fakeSupabase(tables: Record<string, () => { data: unknown; error: unknown }>) {
  return {
    from: (table: string) => {
      const make = tables[table] ?? (() => ({ data: [], error: null }));
      const chain: Record<string, unknown> = {};
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        order: () => proxy,
      };
      for (const key of ['maybeSingle', 'then']) void key;
      // Terminal methods read the table's factory each time, so a test can
      // return different results on a retry.
      proxy.maybeSingle = () => Promise.resolve(make());
      proxy.then = (resolve: (v: unknown) => void) => resolve(make());
      void chain;
      return proxy;
    },
  };
}

const restaurantRow: Row = {
  name: 'Saffron & Smoke',
  tagline: 'Modern Indian',
  address: '12 MG Road',
  phone: '9800000000',
  gstin: '27ABCDE1234F1Z5',
  fssai_number: '11523999999',
  bill_footer_note: 'Thank you!',
  slug: 'saffron',
  timezone: 'Asia/Kolkata',
  tax_rate_bps: 500,
  guest_verification_mode: 'scan_confirm',
  default_service_charge_bps: 300,
  default_packaging_charge_paise: 2000,
  default_delivery_charge_paise: 0,
  round_off_enabled: true,
  operating_mode: 'mode_b',
  pos_integration_name: 'eZee',
};

const gstReady = { ready: true, mode: 'regular' };

const staffOk = (supabase: unknown, role = 'owner') => ({
  ok: true as const,
  context: {
    supabase,
    restaurantId: 'r-1',
    restaurantName: 'Saffron & Smoke',
    role,
    outlets: [{ id: 'r-1', name: 'Saffron & Smoke', role }],
    operatingMode: 'mode_a',
    posIntegrationName: 'fallback-pos',
    entitlement: { outlets: { used: 1, limit: 3, unlimited: false, remaining: 2 } },
  },
});

beforeEach(() => {
  mocks.staff.value = null;
  mocks.origin.value = 'https://new-alpha-five-43.vercel.app';
  mocks.svg.value = '<svg/>';
  mocks.gst.value = gstReady;
  mocks.printers.value = [];
});

function happySupabase(overrides: Partial<Record<string, () => { data: unknown; error: unknown }>> = {}) {
  return fakeSupabase({
    restaurants: () => ({ data: restaurantRow, error: null }),
    menus: () => ({
      data: [
        { id: 'm-1', is_published: true },
        { id: 'm-2', is_published: false },
        { id: 'm-3', is_published: true },
      ],
      error: null,
    }),
    restaurant_coupons: () => ({ data: [], error: null }),
    restaurant_pos_integrations: () => ({ data: null, error: null }),
    ...overrides,
  });
}

describe('getSettingsScreenData', () => {
  it('returns null when Supabase is unconfigured', async () => {
    mocks.staff.value = { ok: false, reason: 'unconfigured' };
    await expect(getSettingsScreenData()).resolves.toBeNull();
  });

  it('reports signed-out and no-membership as blocked, never as a pre-filled form', async () => {
    mocks.staff.value = { ok: false, reason: 'signed-out' };
    await expect(getSettingsScreenData()).resolves.toMatchObject({ blocked: 'signed-out', canEdit: false, details: { name: '' } });
    mocks.staff.value = { ok: false, reason: 'no-membership' };
    await expect(getSettingsScreenData()).resolves.toMatchObject({ blocked: 'no-membership' });
  });

  it('maps the restaurant row, defaults and derived menu counts for an owner', async () => {
    mocks.staff.value = staffOk(happySupabase());
    const data = await getSettingsScreenData();
    expect(data?.blocked ?? null).toBeNull();
    expect(data?.role).toBe('owner');
    expect(data?.canEdit).toBe(true);
    expect(data?.details).toMatchObject({ name: 'Saffron & Smoke', gstin: '27ABCDE1234F1Z5', slug: 'saffron', fssaiNumber: '11523999999' });
    expect(data?.taxRateBps).toBe(500);
    expect(data?.billingDefaults).toEqual({ serviceChargeBps: 300, packagingChargePaise: 2000, deliveryChargePaise: 0, roundOffEnabled: true });
    expect(data?.guestVerificationMode).toBe('scan_confirm');
    expect(data?.publishedMenus).toBe(2);
    expect(data?.totalMenus).toBe(3);
    expect(data?.publicMenuUrl).toBe('https://new-alpha-five-43.vercel.app/menu?s=saffron');
    expect(data?.publicMenuSvg).toBe('<svg/>');
    expect(data?.gst).toBe(gstReady);
    expect(data?.activeOutletId).toBe('r-1');
    expect(data?.outletEntitlement).toEqual({ used: 1, limit: 3, unlimited: false, remaining: 2 });
  });

  it('hides editing from a cashier even when every read succeeds', async () => {
    mocks.staff.value = staffOk(happySupabase(), 'cashier');
    const data = await getSettingsScreenData();
    expect(data?.canEdit).toBe(false);
  });

  it('retries without the new columns when the database predates the mode migration', async () => {
    let restaurantCalls = 0;
    const supabase = fakeSupabase({
      restaurants: () => {
        restaurantCalls += 1;
        return restaurantCalls === 1
          ? { data: null, error: { code: '42703', message: 'column does not exist' } }
          : { data: restaurantRow, error: null };
      },
      menus: () => ({ data: [], error: null }),
      restaurant_coupons: () => ({ data: [], error: null }),
      restaurant_pos_integrations: () => ({ data: null, error: null }),
    });
    mocks.staff.value = staffOk(supabase);

    const data = await getSettingsScreenData();
    expect(restaurantCalls).toBe(2);
    expect(data?.details.name).toBe('Saffron & Smoke');
  });

  it('treats an unknown verification mode as the code default', async () => {
    const supabase = fakeSupabase({
      restaurants: () => ({ data: { ...restaurantRow, guest_verification_mode: 'something-new' }, error: null }),
      menus: () => ({ data: [], error: null }),
      restaurant_coupons: () => ({ data: [], error: null }),
      restaurant_pos_integrations: () => ({ data: null, error: null }),
    });
    mocks.staff.value = staffOk(supabase);
    await expect(getSettingsScreenData()).resolves.toMatchObject({ guestVerificationMode: 'code' });
  });

  it('blocks with no-membership when the membership points at an unreadable restaurant', async () => {
    const supabase = fakeSupabase({
      restaurants: () => ({ data: null, error: null }),
      menus: () => ({ data: [], error: null }),
      restaurant_coupons: () => ({ data: [], error: null }),
      restaurant_pos_integrations: () => ({ data: null, error: null }),
    });
    mocks.staff.value = staffOk(supabase);
    const data = await getSettingsScreenData();
    expect(data?.blocked).toBe('no-membership');
    expect(data?.canEdit).toBe(false);
    expect(data?.details.name).toBe('');
  });

  it('throws on a real restaurant read failure instead of rendering a blank form', async () => {
    const supabase = fakeSupabase({
      restaurants: () => ({ data: null, error: { code: null, message: 'connection reset' } }),
      menus: () => ({ data: [], error: null }),
      restaurant_coupons: () => ({ data: [], error: null }),
      restaurant_pos_integrations: () => ({ data: null, error: null }),
    });
    mocks.staff.value = staffOk(supabase);
    await expect(getSettingsScreenData()).rejects.toThrow('Could not load settings: connection reset');
  });

  it('throws when the menu count read fails, because the QR note depends on it', async () => {
    const supabase = fakeSupabase({
      restaurants: () => ({ data: restaurantRow, error: null }),
      menus: () => ({ data: null, error: { message: 'menu read refused' } }),
      restaurant_coupons: () => ({ data: [], error: null }),
      restaurant_pos_integrations: () => ({ data: null, error: null }),
    });
    mocks.staff.value = staffOk(supabase);
    await expect(getSettingsScreenData()).rejects.toThrow('Could not load menus: menu read refused');
  });

  it('maps coupons and passes printers through', async () => {
    const supabase = fakeSupabase({
      restaurants: () => ({ data: restaurantRow, error: null }),
      menus: () => ({ data: [], error: null }),
      restaurant_coupons: () => ({
        data: [
          {
            id: 'c-1', code: 'WELCOME10', description: 'First visit', discount_type: 'percent',
            discount_value: 10, min_order_paise: 50000, max_discount_paise: 10000,
            max_uses: 100, uses_count: 7, valid_until: '2026-12-31', is_active: true,
          },
          {
            id: 'c-2', code: 'FLAT50', description: '', discount_type: 'flat',
            discount_value: 5000, min_order_paise: 0, max_discount_paise: null,
            max_uses: null, uses_count: null, valid_until: null, is_active: null,
          },
        ],
        error: null,
      }),
      restaurant_pos_integrations: () => ({ data: null, error: null }),
    });
    mocks.staff.value = staffOk(supabase);
    mocks.printers.value = [{ id: 'p-1', name: 'Counter', role: 'counter' }];

    const data = await getSettingsScreenData();
    expect(data?.printers).toEqual([{ id: 'p-1', name: 'Counter', role: 'counter' }]);
    const [first, second] = data?.coupons ?? [];
    expect(first).toEqual({
      id: 'c-1', code: 'WELCOME10', description: 'First visit', discountType: 'percent',
      discountValue: 10, minOrderPaise: 50000, maxDiscountPaise: 10000, maxUses: 100,
      usesCount: 7, validUntil: '2026-12-31', isActive: true,
    });
    expect(second).toMatchObject({ discountType: 'flat', maxDiscountPaise: null, maxUses: null, usesCount: 0, isActive: false });
  });

  it('renders nothing on the QR when the encoder fails, but keeps the URL', async () => {
    mocks.svg.value = null;
    mocks.staff.value = staffOk(happySupabase());
    const data = await getSettingsScreenData();
    expect(data?.publicMenuSvg ?? null).toBeNull();
    expect(data?.publicMenuUrl).toContain('/menu?s=saffron');
  });
});
