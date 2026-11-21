import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_RESTAURANT_COLUMNS,
  isMissingProfileFunction,
  readPublicRestaurant,
  toPublicRestaurantProfile,
} from './public-restaurant';

const ROW = {
  id: '0d2b6f0e-6c61-4f0c-9f43-5f1f1f6f0a11',
  slug: 'spice-route',
  name: 'Spice Route',
  tagline: null,
  address: '12 MG Road',
  phone: '0712-555000',
  timezone: 'Asia/Kolkata',
  tax_rate_bps: 500,
  is_active: true,
  announcement_text: null,
  announcement_on: false,
  logo_path: null,
  banner_path: null,
  accent: 'saffron',
  brand_theme_enabled: false,
  brand_theme: null,
  brand_profile_id: null,
};

/** Columns that exist on the tenant row and must never reach a guest page. */
const PRIVATE = {
  plan: 'business',
  plan_status: 'active',
  plan_started_at: '2026-11-01T00:00:00Z',
  plan_expires_at: '2026-12-01T00:00:00Z',
  trial_started_at: '2026-10-01T00:00:00Z',
  upi_id: 'owner@upi',
  upi_payee_name: 'Owner Name',
  online_payments_enabled: true,
  guest_verification_mode: 'scan',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

function client(options: {
  rpc: { data: unknown; error: { message: string; code?: string } | null };
  table?: { data: unknown; error: { message: string; code?: string } | null };
}) {
  const rpc = vi.fn(() => ({ maybeSingle: async () => options.rpc }));
  const eq = vi.fn(() => ({ maybeSingle: async () => options.table ?? { data: null, error: null } }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { rpc, from, select, eq };
}

describe('readPublicRestaurant', () => {
  it('reads one storefront through the projection function, by trimmed slug', async () => {
    const fake = client({ rpc: { data: ROW, error: null } });
    const result = await readPublicRestaurant(fake, '  spice-route ');
    expect(result).toEqual({ data: ROW, error: null });
    expect(fake.rpc).toHaveBeenCalledWith('public_restaurant_profile', { p_slug: 'spice-route' });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('drops every column outside the public projection, whatever the database returned', async () => {
    const fake = client({ rpc: { data: { ...ROW, ...PRIVATE }, error: null } });
    const { data } = await readPublicRestaurant(fake, 'spice-route');
    expect(Object.keys(data ?? {}).sort()).toEqual([...PUBLIC_RESTAURANT_COLUMNS].sort());
    for (const column of Object.keys(PRIVATE)) expect(data).not.toHaveProperty(column);
  });

  it('makes no database call for a blank slug', async () => {
    const fake = client({ rpc: { data: ROW, error: null } });
    for (const slug of ['', '   ', null, undefined]) {
      expect(await readPublicRestaurant(fake, slug)).toEqual({ data: null, error: null });
    }
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('returns null, not an error, when no restaurant has that slug', async () => {
    const fake = client({ rpc: { data: null, error: null } });
    expect(await readPublicRestaurant(fake, 'nobody')).toEqual({ data: null, error: null });
  });

  it('returns a closed restaurant with is_active false so callers can show the closed state', async () => {
    const fake = client({ rpc: { data: { ...ROW, is_active: false }, error: null } });
    const { data } = await readPublicRestaurant(fake, 'spice-route');
    expect(data?.is_active).toBe(false);
  });

  it('treats a row that does not state it is active as closed', () => {
    const withoutFlag: Record<string, unknown> = { ...ROW };
    delete withoutFlag.is_active;
    expect(toPublicRestaurantProfile(withoutFlag)?.is_active).toBe(false);
    expect(toPublicRestaurantProfile({ ...ROW, is_active: 'true' })?.is_active).toBe(false);
  });

  it('rejects rows without an id and slug', () => {
    expect(toPublicRestaurantProfile(null)).toBeNull();
    expect(toPublicRestaurantProfile([ROW])).toBeNull();
    expect(toPublicRestaurantProfile({ name: 'No identity' })).toBeNull();
  });

  it('falls back to an explicit-column table read only when the function does not exist yet', async () => {
    for (const code of ['PGRST202', '42883']) {
      const fake = client({
        rpc: { data: null, error: { message: 'missing', code } },
        table: { data: { ...ROW, ...PRIVATE }, error: null },
      });
      const { data, error } = await readPublicRestaurant(fake, 'spice-route');
      expect(error).toBeNull();
      expect(data).toEqual(ROW);
      expect(fake.from).toHaveBeenCalledWith('restaurants');
      expect(fake.select).toHaveBeenCalledWith(PUBLIC_RESTAURANT_COLUMNS.join(', '));
      expect(fake.select).not.toHaveBeenCalledWith('*');
      expect(fake.eq).toHaveBeenCalledWith('slug', 'spice-route');
    }
  });

  it('does not fall back on any other failure', async () => {
    const failure = { message: 'permission denied', code: '42501' };
    const fake = client({ rpc: { data: null, error: failure }, table: { data: ROW, error: null } });
    expect(await readPublicRestaurant(fake, 'spice-route')).toEqual({ data: null, error: failure });
    expect(fake.from).not.toHaveBeenCalled();
    expect(isMissingProfileFunction(failure)).toBe(false);
    expect(isMissingProfileFunction(null)).toBe(false);
  });

  it('surfaces a failed fallback read', async () => {
    const failure = { message: 'boom', code: '57014' };
    const fake = client({ rpc: { data: null, error: { message: 'missing', code: 'PGRST202' } }, table: { data: null, error: failure } });
    expect(await readPublicRestaurant(fake, 'spice-route')).toEqual({ data: null, error: failure });
  });
});

describe('public projection boundary', () => {
  // The public identity set is the name, the customer-facing phone and the
  // customer-facing address. GSTIN belongs here: a tax registration number is
  // a billing-document fact, not a storefront one.
  const PRIVATE_COLUMNS = ['plan', 'plan_status', 'plan_started_at', 'plan_expires_at', 'trial_started_at', 'upi_id', 'upi_payee_name', 'created_at', 'updated_at', 'gstin'];

  it('never lists a commercial, payee or timestamp column', () => {
    for (const column of PRIVATE_COLUMNS) expect(PUBLIC_RESTAURANT_COLUMNS).not.toContain(column);
  });

  it('matches the columns returned by the SQL function exactly', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261110000500_public_restaurant_profile.sql'), 'utf8');
    const returns = sql.slice(sql.indexOf('returns table ('), sql.indexOf('language sql'));
    const columns = [...returns.matchAll(/^\s{2}([a-z_]+) [a-z]+,?$/gm)].map((match) => match[1]);
    expect(columns).toEqual([...PUBLIC_RESTAURANT_COLUMNS]);
  });

  // Guest-facing loaders must go through the projection. A direct read of the
  // tenant table returns nothing to a guest after migration 20261110000700.
  it.each([
    'lib/db/menu.ts',
    'lib/db/cart-screen.ts',
    'lib/db/order-screen.ts',
    'lib/db/storefront-status.ts',
    'lib/branding/guest-brand-server.ts',
    'app/(staff)/dashboard/outlet/new/route.ts',
  ])('%s does not read the restaurants table directly', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/\.from\(\s*['"]restaurants['"]\s*\)/);
    expect(source).toContain('readPublicRestaurant(');
  });
});
