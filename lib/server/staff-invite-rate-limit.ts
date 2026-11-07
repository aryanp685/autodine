import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ipHash } from '@/lib/ip-hash';
import type { Database } from '@/lib/db/database';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  consumeInviteAttemptBudget,
  type InviteAttemptAction,
  type InviteAttemptBudgetResult,
} from '@/lib/team-invite-attempt-budget';

/** Consume an invite action budget from a server-only context. */
export async function consumeStaffInviteIpBudget(
  action: InviteAttemptAction,
  code: string,
  admin: SupabaseClient<Database> | null = getSupabaseAdmin(),
): Promise<InviteAttemptBudgetResult> {
  if (!admin) return { allowed: false, reason: 'unavailable', retryAfterSeconds: null };

  const salt = process.env.QR_VERIFICATION_SECRET || process.env.SUPABASE_SECRET_KEY || 'staff-invite-rate-limit';

  let callerHash: string;
  try {
    callerHash = await ipHash(`staff-invite:${salt}`);
  } catch {
    return { allowed: false, reason: 'unavailable', retryAfterSeconds: null };
  }

  return consumeInviteAttemptBudget(action, code, callerHash, async (key, limit, windowSeconds) => {
    const { data, error } = await admin.rpc('hit_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      allowed: row.allowed,
      retryAfterSeconds: row.retry_after_seconds,
    };
  });
}
