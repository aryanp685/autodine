/**
 * Resolve the restaurant a staff member belongs to.
 *
 * WHY THIS FILE EXISTS
 *
 * The customer-facing screens (menu, cart) address a restaurant by slug,
 * because a guest typing a URL has no session to look one up from. The staff
 * screens -- kitchen board, counter, tables, menus -- are the opposite: their
 * RLS policies are written as
 *
 *     restaurant_id in (select public.current_restaurant_ids())
 *
 * which resolves from auth.uid(). There is no slug in that expression at all.
 * So a staff screen that guessed a slug would be reading a restaurant the
 * caller may not belong to, and RLS would silently return zero rows -- the
 * same silent-empty failure that cost us migration 0002.
 *
 * Every staff read and every staff write therefore comes through here. The
 * restaurant id is NEVER taken from a form, a query string, or a prop: it is
 * derived from the session's membership row, so a forged payload can only
 * ever reach a restaurant the caller is already a member of.
 *
 * Returns null in three distinct situations, and callers MUST treat them
 * differently:
 *
 *   1. Supabase not configured        -> null  (render demo data)
 *   2. Configured, no session         -> null  (render a sign-in prompt,
 *                                               never demo data: showing a
 *                                               fake floor plan to someone
 *                                               who is merely logged out
 *                                               looks like real data)
 *   3. Configured, session, no member -> null  (same: prompt, don't fake it)
 *
 * The distinction between 2 and 3 matters for the message shown, so callers
 * that care should use getStaffContextDetailed() below.
 */

import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OUTLET_COOKIE, pickOutlet, type OutletOption } from '@/lib/outlets';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Database, MemberRole } from './database';
import type { RestaurantAccess } from '@/lib/access';

export type StaffContext = {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
  restaurantName: string;
  /**
   * IANA zone the restaurant closes its books in. Read from the row rather
   * than defaulted, because "today" for the dashboard is the restaurant's
   * today and half the countries this could expand into shift their clocks.
   * Falls back to Asia/Kolkata only when the row somehow carries a value the
   * runtime cannot parse.
   */
  timezone: string;
  /** Null when the owner never filled it in. Never substitute sample copy. */
  tagline: string | null;
  /**
   * Needed by the payment RPCs, which take a slug rather than a UUID. The
   * UUID is never accepted from the client; the slug is resolved here from
   * the same membership row, so it cannot be pointed elsewhere.
   */
  slug: string;
  /**
   * The caller's role in this restaurant. Payment RPCs reject anyone who is
   * not owner/manager/cashier, so the UI needs it to explain why the button
   * is disabled instead of letting the click fail with a Postgres error.
   */
  role: MemberRole;
  /**
   * Every outlet this caller belongs to, for the switcher. The ACTIVE one is
   * whichever the cookie named, when the caller still belongs to it -- see
   * lib/outlets.ts. One membership means one entry and no switcher.
   */
  outlets: OutletOption[];
  /**
   * The plan and trial clock, read from public.restaurant_access(). Null when
   * the read failed — a migration not yet applied, a transient error — and
   * every caller renders as if the workspace were open, because a failed read
   * must never be what puts a restaurant into read-only mode. The database
   * still refuses writes it does not like; this is only what the screen says.
   */
  access: RestaurantAccess | null;
};

/** Roles allowed to take money at the counter. Mirrors record_cash_payment. */
export const CASHIER_ROLES: MemberRole[] = ['owner', 'manager', 'cashier'];

/**
 * Roles allowed to move a ticket along the kitchen board.
 *
 * MIRRORS THE DATABASE, and the database is the authority. The update policy on
 * `orders` (orders_staff_update) is:
 *
 *   has_restaurant_role(restaurant_id,
 *     array['owner','manager','kitchen']) and restaurant_can_write(restaurant_id)
 *
 * This constant exists so the board can hide a button that would be refused,
 * instead of offering it and surfacing a Postgres permission error to a cook.
 * If the policy and this list ever disagree, the policy wins and the action's
 * error path is what the operator sees -- which is the safe direction.
 */
export const KITCHEN_ROLES: MemberRole[] = ['owner', 'manager', 'kitchen'];

/** Why a staff context could not be resolved. */
export type StaffBlockedReason =
  | 'unconfigured' // Supabase env vars missing
  | 'signed-out' // configured, but no valid session
  | 'no-membership'; // signed in, but belongs to no restaurant

export type StaffContextResult =
  | { ok: true; context: StaffContext }
  | { ok: false; reason: StaffBlockedReason };

/**
 * Resolve the caller's restaurant.
 *
 * All of the caller's memberships are read, not just one. The restaurant this
 * request works on is the one named by the OUTLET_COOKIE, and only when that
 * cookie names a restaurant the caller is actually a member of -- a cookie is
 * a preference, never a permission. With no cookie, or a stale one, the
 * choice falls back to the lowest restaurant_id, which is the deterministic
 * answer this function always gave before the switcher existed.
 *
 * The name, slug and timezone come from the same embed, so picking a
 * different outlet costs no extra round trip.
 */
export async function getStaffContextDetailed(): Promise<StaffContextResult> {
  if (!isSupabaseConfigured) return { ok: false, reason: 'unconfigured' };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, reason: 'unconfigured' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'signed-out' };

  type MembershipRow = {
    restaurant_id: string;
    role: MemberRole;
    restaurants:
      | { name: string; slug: string; timezone: string | null; tagline: string | null }
      | Array<{ name: string; slug: string; timezone: string | null; tagline: string | null }>
      | null;
  };

  const { data: membershipRows, error: membershipError } = await supabase
    .from('memberships')
    .select('restaurant_id, role, restaurants(name, slug, timezone, tagline)')
    .eq('user_id', user.id)
    .order('restaurant_id', { ascending: true });

  if (membershipError || !membershipRows || membershipRows.length === 0) {
    return { ok: false, reason: 'no-membership' };
  }

  // The embed comes back as an object for a to-one relation and as an array in
  // some PostgREST configurations; both are handled rather than assumed.
  const rows = (membershipRows as unknown as MembershipRow[])
    .map((row) => {
      const restaurant = Array.isArray(row.restaurants) ? row.restaurants[0] : row.restaurants;
      if (!restaurant?.name) return null;
      return {
        id: row.restaurant_id,
        role: row.role,
        name: restaurant.name,
        slug: restaurant.slug,
        timezone: restaurant.timezone,
        tagline: restaurant.tagline,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return { ok: false, reason: 'no-membership' };

  const cookieStore = await cookies();
  const preferred = cookieStore.get(OUTLET_COOKIE)?.value ?? null;
  const active = pickOutlet(rows, preferred);
  if (!active) return { ok: false, reason: 'no-membership' };

  // One extra round trip, on staff screens only, for the line that says how
  // long the trial has left. It is deliberately not fatal: if the function is
  // missing (migrations not applied yet) the context still resolves and the
  // screens still work.
  const access = await loadAccess(supabase, active.id);

  return {
    ok: true,
    context: {
      supabase,
      restaurantId: active.id,
      restaurantName: active.name,
      slug: active.slug,
      timezone: active.timezone ?? 'Asia/Kolkata',
      tagline: active.tagline ?? null,
      role: active.role,
      outlets: rows.map(({ id, name, role }) => ({ id, name, role })),
      access,
    },
  };
}

/** Convenience wrapper for callers that only need the context, if any. */
export async function getStaffContext(): Promise<StaffContext | null> {
  const result = await getStaffContextDetailed();
  return result.ok ? result.context : null;
}

/**
 * Read the plan/trial state for one restaurant.
 *
 * Returns null rather than throwing. Two reasons, both deliberate:
 *
 *   1. A deployment that has not applied migration 20261026001100 has no
 *      restaurant_access() function. That is a setup problem, not a reason to
 *      break every owner screen.
 *   2. The value is DISPLAY. The write gate that actually matters lives in the
 *      database, on the same function the RLS policies call, and it does not
 *      care whether this read succeeded.
 */
async function loadAccess(
  supabase: SupabaseClient<Database>,
  restaurantId: string
): Promise<RestaurantAccess | null> {
  const { data, error } = await supabase.rpc('restaurant_access', {
    p_restaurant_id: restaurantId,
  });

  if (error || !data) {
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      console.error('[staff] restaurant_access failed', error.message);
    }
    return null;
  }

  return {
    plan: String(data.plan ?? 'trial'),
    status: String(data.status ?? 'trialing'),
    trialEndsAt: data.trial_ends_at ?? null,
    daysRemaining: Number(data.days_remaining ?? 0),
    canWrite: data.can_write !== false,
    readOnly: data.read_only === true,
    features: Array.isArray(data.features) ? data.features : [],
  };
}
