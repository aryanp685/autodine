import { createHash } from 'node:crypto';
import { normaliseInviteCode } from '@/lib/team-invite';

export type InviteAttemptAction = 'accept' | 'signup';

export type InviteAttemptBudgetResult =
  | { allowed: true }
  | { allowed: false; reason: 'limited'; retryAfterSeconds: number }
  | { allowed: false; reason: 'unavailable'; retryAfterSeconds: null };

export type HitRateLimit = (
  key: string,
  limit: number,
  windowSeconds: number,
) => Promise<{ allowed: boolean; retryAfterSeconds: number | null } | null>;

const ACTION_BUDGETS: Record<InviteAttemptAction, { limit: number; windowSeconds: number; key: 'ip' | 'ip_code' }[]> = {
  // A restaurant may onboard a team in one sitting, so IP thresholds allow
  // several staff while stopping an automated signup burst.
  signup: [
    { limit: 12, windowSeconds: 60 * 60, key: 'ip' },
    { limit: 5, windowSeconds: 60 * 60, key: 'ip_code' },
  ],
  accept: [
    { limit: 30, windowSeconds: 15 * 60, key: 'ip' },
    { limit: 10, windowSeconds: 15 * 60, key: 'ip_code' },
  ],
};

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Atomically consumes the server-side invitation budget. Neither the raw IP
 * address nor the human-readable invite code appears in the database key.
 * `hit` is injected so the budget policy can be tested without a Supabase
 * service client.
 */
export async function consumeInviteAttemptBudget(
  action: InviteAttemptAction,
  code: string,
  ipFingerprint: string,
  hit: HitRateLimit,
): Promise<InviteAttemptBudgetResult> {
  const codeFingerprint = fingerprint(normaliseInviteCode(code));

  for (const budget of ACTION_BUDGETS[action]) {
    const subject = budget.key === 'ip' ? ipFingerprint : `${ipFingerprint}:${codeFingerprint}`;
    const key = `staff-invite:${action}:${budget.key}:${subject}`;
    let result: Awaited<ReturnType<HitRateLimit>>;
    try {
      result = await hit(key, budget.limit, budget.windowSeconds);
    } catch {
      return { allowed: false, reason: 'unavailable', retryAfterSeconds: null };
    }
    if (!result) return { allowed: false, reason: 'unavailable', retryAfterSeconds: null };
    if (!result.allowed) {
      return {
        allowed: false,
        reason: 'limited',
        retryAfterSeconds: Math.max(1, Math.min(86_400, result.retryAfterSeconds ?? budget.windowSeconds)),
      };
    }
  }

  return { allowed: true };
}
