/**
 * Trial renewal — server-side only.
 *
 * WHY THIS EXISTS
 *
 * Since migration 20261110001000 the trial clock is a server-side fact on the
 * ACCOUNT: `accounts.trial_ends_at`, compared against `now()` in the database.
 * The browser cannot move it, and neither can a signed-in user — the
 * `protect_account_plan()` trigger preserves subscription columns whenever
 * `auth.uid()` is not null.
 *
 * Only server-side code arriving with the service role (auth.uid() null) may
 * change a subscription. This action is that code.
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
 * Sets the trial end to `now() + 21 days` for the ACCOUNT that owns the
 * restaurant whose name matches the query, through
 * `public.admin_set_subscription()`. The whole account trials together —
 * that is Model C: one subscription, shared by every outlet. Plan start and
 * expiry are cleared, because a trial is not a paid term.
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
import { TRIAL_DAYS } from '@/lib/trial';

export type RenewTrialResult = {
  ok: boolean;
  restaurantName?: string;
  trialEndsAt?: string;
  error?: string;
};

/**
 * Renew the trial of the account that owns a restaurant, by restaurant name.
 *
 * The lookup happens in the database (public.admin_set_subscription, migration
 * 20261110001000), which refuses a name that matches more than one account
 * instead of silently renewing one of them.
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
  const { data, error } = await supabase.rpc('admin_set_subscription', {
    p_restaurant_name: name,
    p_plan: 'trial',
    p_days: TRIAL_DAYS,
  });

  if (error) {
    if (error.message.includes('restaurant_not_found')) {
      return { ok: false, error: `No restaurant found with name \"${name}\".` };
    }
    if (error.message.includes('restaurant_ambiguous')) {
      return { ok: false, error: `Several accounts own a restaurant called \"${name}\". Use the exact name.` };
    }
    return { ok: false, error: `Could not renew the trial: ${error.message}` };
  }
  if (!data?.trial_ends_at) {
    return { ok: false, error: 'Could not read the new trial end date.' };
  }

  revalidatePath('/dashboard', 'layout');
  revalidatePath('/dashboard/settings', 'layout');
  return {
    ok: true,
    restaurantName: name,
    trialEndsAt: data.trial_ends_at,
  };
}
