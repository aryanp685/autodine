import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { addressFromHeaders, hashAddress } from '@/lib/ip-hash';
import type { Database } from '@/lib/db/database';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * A guest recovering their order is one lookup per page reload, so a whole
 * table reconnecting after a wifi blip stays inside this. It is a brake on a
 * script walking tokens, not a fence: the token itself is a UUID secret and
 * guessing one is already out of reach.
 */
export const GUEST_RECOVER_BUDGET = { limit: 60, windowSeconds: 300 } as const;

export type GuestRecoverBudget =
  | { state: 'allow' }
  | { state: 'limited'; retryAfterSeconds: number }
  | { state: 'unavailable' };

export async function consumeGuestRecoverBudget(
  get: (name: string) => string | null,
  admin: SupabaseClient<Database> | null = getSupabaseAdmin(),
): Promise<GuestRecoverBudget> {
  if (!admin) return { state: 'unavailable' };

  const salt = process.env.QR_VERIFICATION_SECRET || process.env.SUPABASE_SECRET_KEY || 'guest-recover-rate-limit';
  const key = `orders:recover:addr:${hashAddress(addressFromHeaders(get), `recover:${salt}`)}`;

  const { data, error } = await admin.rpc('hit_rate_limit', {
    p_key: key,
    p_limit: GUEST_RECOVER_BUDGET.limit,
    p_window_seconds: GUEST_RECOVER_BUDGET.windowSeconds,
  });
  if (error) return { state: 'unavailable' };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { state: 'unavailable' };
  return row.allowed ? { state: 'allow' } : { state: 'limited', retryAfterSeconds: row.retry_after_seconds };
}
