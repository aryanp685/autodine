import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ipHash } from '@/lib/ip-hash';
import type { Database } from '@/lib/db/database';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  consumeSignInAttemptBudget,
  type SignInAttemptBudgetResult,
} from '@/lib/sign-in-attempt-budget';

/**
 * Consume a sign-in attempt budget from a server-only context.
 *
 * Unlike the staff-invite budget this one is CALLED FROM A SERVER ACTION that
 * is already about to hand the password to Supabase, so a limiter that cannot
 * answer must not become a product outage: 'unavailable' is returned and the
 * caller lets the attempt through with a structured warning. The brake still
 * works whenever the store does, and Supabase Auth has its own limits under it.
 */
export async function consumeSignInAttemptBudgetForCaller(
  email: string,
  admin: SupabaseClient<Database> | null = getSupabaseAdmin(),
): Promise<SignInAttemptBudgetResult> {
  if (!admin) return { allowed: false, reason: 'unavailable', retryAfterSeconds: null };

  const salt = process.env.QR_VERIFICATION_SECRET || process.env.SUPABASE_SECRET_KEY || 'sign-in-rate-limit';

  let callerHash: string;
  try {
    callerHash = await ipHash(`sign-in:${salt}`);
  } catch {
    return { allowed: false, reason: 'unavailable', retryAfterSeconds: null };
  }

  return consumeSignInAttemptBudget(email, callerHash, async (key, limit, windowSeconds) => {
    const { data, error } = await admin.rpc('hit_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
  });
}
