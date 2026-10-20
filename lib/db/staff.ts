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

import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Database } from './database';

export type StaffContext = {
  supabase: SupabaseClient<Database>;
  restaurantId: string;
  restaurantName: string;
};

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
 * Membership is fetched with .limit(1) because a user may belong to several
 * restaurants and this build has no workspace switcher yet -- there is no UI
 * for choosing between them, so we take one deterministically and the schema
 * already allows the rest. Ordering by restaurant_id keeps that choice stable
 * across requests instead of letting Postgres hand back whichever row it
 * happens to find first, which would make the board flicker between two
 * restaurants on refresh.
 */
export async function getStaffContextDetailed(): Promise<StaffContextResult> {
  if (!isSupabaseConfigured) return { ok: false, reason: 'unconfigured' };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, reason: 'unconfigured' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'signed-out' };

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('restaurant_id')
    .eq('user_id', user.id)
    .order('restaurant_id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) return { ok: false, reason: 'no-membership' };

  const restaurantId = membership.restaurant_id as string;

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, name')
    .eq('id', restaurantId)
    .maybeSingle();

  if (restaurantError || !restaurant) return { ok: false, reason: 'no-membership' };

  return {
    ok: true,
    context: { supabase, restaurantId, restaurantName: restaurant.name },
  };
}

/** Convenience wrapper for callers that only need the context, if any. */
export async function getStaffContext(): Promise<StaffContext | null> {
  const result = await getStaffContextDetailed();
  return result.ok ? result.context : null;
}
