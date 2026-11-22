import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chainable supabase client is mocked rather than the network. The four
 * reads (tables, live QR codes, order activity, verification code) and the
 * status mapping built on them are the logic under test here; the SQL filters
 * themselves (restaurant scoping, revoked_at) are enforced by Postgres and
 * covered by the database integration suite.
 */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  staff: { value: null as unknown },
  qr: { svg: '<svg/>' as string | null },
}));

vi.mock('./staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.value),
}));

vi.mock('../qr', () => ({
  siteOrigin: () => Promise.resolve('https://new-alpha-five-43.vercel.app'),
  tableScanUrl: (origin: string, token: string) => `${origin}/join?t=${token}`,
  qrSvg: () => Promise.resolve(mocks.qr.svg),
}));

import { getTablesScreenData } from './tables-screen';

/** Minimal chainable builder good enough for the four reads in the loader. */
function fakeSupabase(rows: Record<string, Row[]>, rpc: Record<string, { data: unknown; error: unknown }>) {
  const respond = (key: string) => ({
    data: rows[key] ?? [],
    error: null,
  });
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          is: () => respond(table),
          order: () => respond(table),
        }),
        eq2: undefined,
      }),
    }),
    rpc: (fn: string) => Promise.resolve(rpc[fn] ?? { data: null, error: null }),
  };
}

const staffOk = (supabase: unknown) => ({
  ok: true as const,
  context: { supabase, restaurantId: 'r-1', restaurantName: 'Saffron & Smoke' },
});

beforeEach(() => {
  mocks.staff.value = null;
  mocks.qr.svg = '<svg/>';
});

describe('getTablesScreenData', () => {
  it('returns null when Supabase is unconfigured', async () => {
    mocks.staff.value = { ok: false, reason: 'unconfigured' };
    await expect(getTablesScreenData()).resolves.toBeNull();
  });

  it('reports signed-out and no-membership as blocked, not as an error', async () => {
    mocks.staff.value = { ok: false, reason: 'signed-out' };
    await expect(getTablesScreenData()).resolves.toMatchObject({ blocked: 'signed-out' });
    mocks.staff.value = { ok: false, reason: 'no-membership' };
    await expect(getTablesScreenData()).resolves.toMatchObject({ blocked: 'no-membership' });
  });

  it('maps a live-code table to active and a switched-off table to disabled', async () => {
    const supabase = fakeSupabase(
      {
        dining_tables: [
          { id: 't-1', label: 'T1', seats: 4, is_active: true },
          { id: 't-2', label: 'T2', seats: 2, is_active: false },
        ],
        table_qr_codes: [{ id: 'q-1', table_id: 't-1', public_token: 'abc123', created_at: '2026-11-01T00:00:00Z' }],
      },
      {
        table_order_activity: { data: [{ table_id: 't-1', order_count: 3, last_order_at: '2026-11-22T10:00:00Z' }], error: null },
      },
    );
    mocks.staff.value = staffOk(supabase);

    const data = await getTablesScreenData();
    expect(data?.restaurantName).toBe('Saffron & Smoke');
    const [t1, t2] = data?.tables ?? [];
    expect(t1?.qr).toBe('active');
    expect(t1?.token).toBe('abc123');
    expect(t1?.scanUrl).toBe('https://new-alpha-five-43.vercel.app/join?t=abc123');
    expect(t1?.orders).toBe(3);
    expect(t1?.qrSvg).toBe('<svg/>');
    expect(t2?.qr).toBe('disabled');
    expect(t2?.token ?? null).toBeNull();
  });

  it('labels an active table with no live code as no-code, not revoked', async () => {
    const supabase = fakeSupabase(
      {
        dining_tables: [{ id: 't-9', label: 'T9', seats: 6, is_active: true }],
        table_qr_codes: [],
      },
      {},
    );
    mocks.staff.value = staffOk(supabase);

    const data = await getTablesScreenData();
    expect(data?.tables[0]?.qr).toBe('no-code');
    expect(data?.tables[0]?.orders).toBe(0);
  });

  it('still shows the floor plan when only the verification-code read fails', async () => {
    const supabase = fakeSupabase(
      {
        dining_tables: [{ id: 't-1', label: 'T1', seats: 4, is_active: true }],
        table_qr_codes: [{ id: 'q-1', table_id: 't-1', public_token: 'tok', created_at: null }],
      },
      {
        table_order_activity: { data: [], error: null },
        current_verification_code: { data: null, error: { message: 'permission denied' } },
      },
    );
    mocks.staff.value = staffOk(supabase);

    const data = await getTablesScreenData();
    expect(data?.tables).toHaveLength(1);
    expect(data?.verification ?? null).toBeNull();
    expect(data?.verificationError).toBeTruthy();
  });

  it('throws on a real tables read failure instead of rendering an empty room', async () => {
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({ data: [], error: { message: 'connection reset' } }),
            is: () => ({ data: [], error: null }),
          }),
        }),
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    mocks.staff.value = staffOk(supabase);
    await expect(getTablesScreenData()).rejects.toThrow('Could not load tables: connection reset');
  });

  it('renders nothing when the QR encoder fails for a token', async () => {
    mocks.qr.svg = null;
    const supabase = fakeSupabase(
      {
        dining_tables: [{ id: 't-1', label: 'T1', seats: 4, is_active: true }],
        table_qr_codes: [{ id: 'q-1', table_id: 't-1', public_token: 'tok', created_at: null }],
      },
      {},
    );
    mocks.staff.value = staffOk(supabase);
    const data = await getTablesScreenData();
    expect(data?.tables[0]?.qrSvg ?? null).toBeNull();
    expect(data?.tables[0]?.scanUrl).toBeTruthy();
  });
});
