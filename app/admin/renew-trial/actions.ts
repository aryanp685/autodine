/**
 * Trial renewal — server-side only.
 *
 * WHY THIS EXISTS
 *
 * The trial clock is a server-side fact: `restaurants.trial_started_at`
 * plus `interval '7 days'`, compared against `now()` in the database.
 * The browser cannot move it, and neither can a signed-in user — the
 * `protect_restaurant_plan()` trigger in migration 20261026001100
 * preserves plan columns when `auth.uid()` is not null.
 *
 * Only server-side code arriving with the service role (auth.uid() null)
 * may change `trial_started_at`. This action is that code.
 *
 * WHO MAY CALL IT
 *
 * Nobody from the browser. This is a server-only action that must be
 * called from a server component, a script, or an admin route — never
 * from client-side code. The admin Supabase client bypasses RLS, which
 * is exactly why it must never reach the browser bundle.
 *
 * WHAT IT DOES
 *
 * Sets `trial_started_at` to `now()` for the restaurant whose name
 * matches the query. This starts a fresh 7-day trial from the moment
 * of the call. The restaurant's plan columns (plan, plan_status, etc.)
 * are untouched — only the trial start moves.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not charge anybody. It does not change the plan. It does not
 * delete data. It only moves the trial clock forward.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';

export type RenewTrialResult = {
  ok: boolean;
  restaurantName?: string;
  trialEndsAt?: string;
  error?: string;
};

/**
 * Renew the 7-day trial for a restaurant by name.
 *
 * @param restaurantName The exact restaurant name to match.
 * @returns Success with the new trial end date, or an error message.
 */
export async function renewTrialAction(restaurantName: string): Promise<RenewTrialResult> {
  if (!isSupabaseAdminConfigured) {
    return { ok: false, error: 'Database is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.' };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, error: 'Database is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.' };
  }

  // Find the restaurant by exact name match.
  const { data: restaurants, error: findError } = await supabase
    .from('restaurants')
    .select('id, name, trial_started_at')
    .ilike('name', restaurantName.trim());

  if (findError) {
    return { ok: false, error: `Could not find restaurant: ${findError.message}` };
  }

  if (!restaurants || restaurants.length === 0) {
    return { ok: false, error: `No restaurant found with name "${restaurantName}".` };
  }

  // If multiple restaurants match, use the first one and warn.
  if (restaurants.length > 1) {
    console.warn(`[renew-trial] Multiple restaurants match "${restaurantName}". Using the first: ${restaurants[0].name}`);
  }

  const restaurant = restaurants[0];

  // Update trial_started_at to now(). The protect_restaurant_plan() trigger
  // allows this because auth.uid() is null (service role).
  const { data: updated, error: updateError } = await supabase
    .from('restaurants')
    .update({ trial_started_at: new Date().toISOString() })
    .eq('id', restaurant.id)
    .select('id, name, trial_started_at')
    .single();

  if (updateError) {
    return { ok: false, error: `Could not renew trial: ${updateError.message}` };
  }

  // Compute the new trial end date (7 days from now).
  if (!updated.trial_started_at) {
    return { ok: false, error: 'Could not read trial start time after update.' };
  }
  const trialEndsAt = new Date(updated.trial_started_at);
  trialEndsAt.setDate(trialEndsAt.getDate() + 7);

  revalidatePath('/dashboard', 'layout');
  revalidatePath('/dashboard/settings', 'layout');

  return {
    ok: true,
    restaurantName: updated.name,
    trialEndsAt: trialEndsAt.toISOString(),
  };
}
