import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ipHash } from '@/lib/ip-hash';
import type { Database } from '@/lib/db/database';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  SIGN_IN_BUDGETS,
  consumeSignInAttemptBudget,
  signInBudgetKeys,
  type SignInAttemptBudgetResult,
} from '@/lib/sign-in-attempt-budget';

/** The salted caller fingerprint both the charge and the refund key off. */
async function callerFingerprint(): Promise<string | null> {
  const salt = process.env.QR_VERIFICATION_SECRET || process.env.SUPABASE_SECRET_KEY || 'sign-in-rate-limit';
  try {
    return await ipHash(`sign-in:${salt}`);
  } catch {
    return null;
  }
}

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

  const callerHash = await callerFingerprint();
  if (!callerHash) return { allowed: false, reason: 'unavailable', retryAfterSeconds: null };

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

/**
 * Hand back the attempt a successful sign-in was charged for.
 *
 * The counters must measure guesses, not logins: a shift signing in behind one
 * office line, or the database-flow suite signing the same seeded owner in
 * test after test, is not an attack and must not spend the allowance. Only a
 * password that was refused leaves its mark. Best effort by design -- a refund
 * that cannot be written must never fail a sign-in that already succeeded.
 */
export async function releaseSignInAttemptBudgetForCaller(
  email: string,
  admin: SupabaseClient<Database> | null = getSupabaseAdmin(),
): Promise<void> {
  if (!admin) return;

  const callerHash = await callerFingerprint();
  if (!callerHash) return;

  const keys = signInBudgetKeys(email, callerHash);
  await Promise.all(
    SIGN_IN_BUDGETS.map(async (budget) => {
      const key = budget.subject === 'address' ? keys.address : keys.account;
      const { error } = await admin.rpc('release_rate_limit_hit', { p_key: key });
      if (error) {
        console.warn(
          `[autodine:alert] ${JSON.stringify({
            event: 'sign_in_rate_limit_release_failed',
            kind: 'sign_in_rate_limit_release_failed',
            severity: 'warning',
          })}`,
        );
      }
    }),
  );
}
