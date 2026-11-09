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
 * Only a caller holding the server's admin secret (see lib/admin-auth.ts):
 * the admin page's form, or POST /api/admin/renew-trial. The check lives
 * inside this action on purpose — protecting one entry point protects
 * nothing if another can reach the same write. Every caller, however it
 * arrives, passes the same gate before any database work happens.
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
import { isValidAdminSecret, UNAUTHORIZED_MESSAGE } from '@/lib/admin-auth';

export type RenewTrialResult = {
  ok: boolean;
  restaurantName?: string;
  trialEndsAt?: string;
  error?: string;
};

/** Exact case-insensitive regex: unlike PostgREST ILIKE, '*' is not an alias
 * for '%'. Escape every regex operator so restaurant names stay literal. */
function exactNamePattern(name: string): string {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/**
 * Renew the 7-day trial for a restaurant by name.
 *
 * @param restaurantName The exact restaurant name to match.
 * @param adminSecret The server's admin secret, verified here and not
 *   merely upstream: this action is a privileged write, and every route
 *   into it must carry the same credential.
 * @returns Success with the new trial end date, or an error message.
 */
export async function renewTrialAction(restaurantName: string, adminSecret: string): Promise<RenewTrialResult> {
  // The gate. Before configuration checks, before any database work: an
  // unauthorized caller learns nothing about this server's state.
  if (!isValidAdminSecret(adminSecret)) {
    return { ok: false, error: UNAUTHORIZED_MESSAGE };
  }

  const name = typeof restaurantName === 'string' ? restaurantName.trim() : '';
  if (!name || name.length > 200) {
    return { ok: false, error: 'Missing restaurantName' };
  }

  if (!isSupabaseAdminConfigured) {
    return { ok: false, error: 'Database is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.' };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, error: 'Database is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.' };
  }

  // Find the restaurant by exact name match (case-insensitive). The
  // regex is anchored and escaped so the name can only ever mean itself.
  const { data: restaurants, error: findError } = await supabase
    .from('restaurants')
    .select('id, name, trial_started_at')
    .filter('name', 'imatch', exactNamePattern(name));

  if (findError) {
    return { ok: false, error: `Could not find restaurant: ${findError.message}` };
  }

  if (!restaurants || restaurants.length === 0) {
    return { ok: false, error: `No restaurant found with name "${name}".` };
  }

  // Ambiguity is refused, not guessed. Renewing "the first" match would
  // move some restaurant's trial clock that nobody named.
  if (restaurants.length > 1) {
    return { ok: false, error: `Multiple restaurants match "${name}". Use the exact name.` };
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
  const trialEndsAt = new Date(
    new Date(updated.trial_started_at).getTime() + 7 * 24 * 60 * 60 * 1000
  );

  revalidatePath('/dashboard', 'layout');
  revalidatePath('/dashboard/settings', 'layout');

  return {
    ok: true,
    restaurantName: updated.name,
    trialEndsAt: trialEndsAt.toISOString(),
  };
}
