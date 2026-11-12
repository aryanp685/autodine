/**
 * The one way guest-facing code reads a restaurant.
 *
 * A guest (or a signed-in user who is not staff of that restaurant) may see
 * one storefront, addressed by its slug, and only the storefront columns
 * below. The tenant row also carries plan and trial state, UPI payee
 * details and the GSTIN; none of that belongs on a public page and none of
 * it is selected here. The public identity set is the name, the
 * customer-facing phone and the customer-facing address. A GSTIN reaches a
 * guest only on a bill the business issues, through lib/db/bill.ts, which
 * is staff-authenticated.
 *
 * The read goes through `public_restaurant_profile` (migration
 * 20261110000500), which cannot list restaurants. Migration 20261110000700
 * then removes direct guest access to `public.restaurants`, so a guest-side
 * `.from('restaurants')` returns nothing afterwards. Always use this helper.
 *
 * Rollout tolerance: on a database that does not have the function yet, the
 * helper falls back to the legacy direct read with the same explicit column
 * list. It never selects `*`.
 */

import type { Restaurant } from './types';

export const PUBLIC_RESTAURANT_COLUMNS = [
  'id',
  'slug',
  'name',
  'tagline',
  'address',
  'phone',
  'timezone',
  'tax_rate_bps',
  'is_active',
  'announcement_text',
  'announcement_on',
  'logo_path',
  'banner_path',
  'accent',
  'brand_theme_enabled',
  'brand_theme',
  'brand_profile_id',
] as const;

export type PublicRestaurantColumn = (typeof PUBLIC_RESTAURANT_COLUMNS)[number];

/** Exactly the public projection: the guest `Restaurant` contract and nothing else. */
export type PublicRestaurantProfile = Pick<Restaurant, PublicRestaurantColumn>;

export type PublicRestaurantReadError = { message: string; code?: string };

export type PublicRestaurantResult = {
  data: PublicRestaurantProfile | null;
  error: PublicRestaurantReadError | null;
};

type QueryResult = PromiseLike<{ data: unknown; error: PublicRestaurantReadError | null }>;

/** The calls this helper makes, in the shape it makes them. */
type PublicRestaurantReader = {
  rpc(fn: string, args: Record<string, unknown>): { maybeSingle(): QueryResult };
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): QueryResult };
    };
  };
};

/**
 * Any Supabase client. Deliberately loose: the generated Database type lists
 * RPCs by name, and this helper must also run against a database that predates
 * the function.
 */
export type PublicRestaurantClient = {
  rpc: (...args: never[]) => unknown;
  from: (...args: never[]) => unknown;
};

/** PostgREST "function not in schema cache" or PostgreSQL undefined_function. */
export function isMissingProfileFunction(error: PublicRestaurantReadError | null): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

/**
 * Copies only the allow-listed columns. Whatever the database returned, nothing
 * outside the public projection can cross into a page or a client component.
 */
export function toPublicRestaurantProfile(row: unknown): PublicRestaurantProfile | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const source = row as Record<string, unknown>;
  if (typeof source.id !== 'string' || typeof source.slug !== 'string') return null;
  const picked: Record<string, unknown> = {};
  for (const column of PUBLIC_RESTAURANT_COLUMNS) picked[column] = source[column] ?? null;
  // A row that does not say it is active is treated as closed.
  picked.is_active = source.is_active === true;
  picked.announcement_on = source.announcement_on === true;
  picked.brand_theme_enabled = source.brand_theme_enabled === true;
  return picked as PublicRestaurantProfile;
}

/**
 * Reads one storefront by slug. Returns the row whether or not the restaurant
 * is active: callers that must hide a closed restaurant check `is_active`,
 * exactly as their previous `.eq('is_active', true)` filter did.
 */
export async function readPublicRestaurant(
  client: PublicRestaurantClient,
  slug: string | null | undefined,
): Promise<PublicRestaurantResult> {
  const target = slug?.trim() ?? '';
  if (!target) return { data: null, error: null };
  const supabase = client as unknown as PublicRestaurantReader;

  const projected = await supabase.rpc('public_restaurant_profile', { p_slug: target }).maybeSingle();
  if (!projected.error) return { data: toPublicRestaurantProfile(projected.data), error: null };
  if (!isMissingProfileFunction(projected.error)) return { data: null, error: projected.error };

  const legacy = await supabase
    .from('restaurants')
    .select(PUBLIC_RESTAURANT_COLUMNS.join(', '))
    .eq('slug', target)
    .maybeSingle();
  if (legacy.error) return { data: null, error: legacy.error };
  return { data: toPublicRestaurantProfile(legacy.data), error: null };
}
