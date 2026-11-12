/**
 * Load the Subscription screen.
 *
 * Everything on this screen is read through the account's own functions
 * (migration 20261110001100), which check membership themselves: a caller
 * naming a restaurant they do not work for gets null, not a row. The
 * restaurant id comes from the session's membership — see lib/db/staff.ts —
 * so there is no id in a URL that could point this at somebody else's
 * subscription.
 *
 * The screen is built to be honest in three states that look alike and are
 * not: a running trial, a paid plan whose period is ending, and a paid plan
 * whose payment failed. All three keep the owner's data; only one of them is
 * the owner's fault.
 */

import { getStaffContextDetailed } from './staff';
import { PLAN_PRICES, planName } from '@/lib/billing/catalog';
import { isBillingProviderConfigured } from '@/lib/billing/provider';
import type { OutletBar } from '@/lib/outlets';

export type SubscriptionState = {
  accountId: string;
  plan: string;
  planLabel: string;
  status: string;
  /** The approved monthly price in paise. Null for a trial, which has none. */
  pricePaise: number | null;
  trial: {
    startedAt: string | null;
    endsAt: string | null;
    daysRemaining: number;
    running: boolean;
  };
  period: {
    startedAt: string | null;
    expiresAt: string | null;
    endsAt: string | null;
  };
  cancellation: null | {
    requestedAt: string;
    effectiveAt: string | null;
    confirmed: boolean;
  };
  outlets: {
    used: number;
    limit: number | null;
    unlimited: boolean;
    remaining: number | null;
  };
  canWrite: boolean;
  readOnly: boolean;
  pastDue: boolean;
  expired: boolean;
  lastPayment: null | {
    amountPaise: number;
    status: string;
    paidAt: string;
    receipt: string | null;
    failureReason: string | null;
  };
};

export type SubscriptionEventRow = {
  id: string;
  kind: string;
  fromPlan: string | null;
  toPlan: string | null;
  amountPaise: number | null;
  currency: string | null;
  provider: string | null;
  actor: string;
  note: string | null;
  occurredAt: string;
};

export type PaymentRow = {
  id: string;
  plan: string;
  planLabel: string;
  amountPaise: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string;
  provider: string | null;
  failureReason: string | null;
  receipt: string | null;
  receiptId: string | null;
};

export type ReceiptRow = {
  id: string;
  receiptNumber: string;
  plan: string;
  planLabel: string;
  amountPaise: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string;
  issuedAt: string;
  provider: string | null;
  accountId: string;
  restaurantName: string | null;
};

export type SubscriptionScreenData = {
  role: string;
  state: SubscriptionState | null;
  history: SubscriptionEventRow[];
  payments: PaymentRow[];
  /** The catalog, so the screen never prints a price it made up. */
  catalog: typeof PLAN_PRICES;
  /** False: no provider is approved, so nothing can be bought. Read-only UI. */
  providerConfigured: boolean;
};

export type SubscriptionScreenResult =
  | { ok: true; data: SubscriptionScreenData; outlet: OutletBar | null }
  | { ok: false; reason: 'unconfigured' | 'signed-out' | 'no-membership' };

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toState(raw: unknown): SubscriptionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const trial = (r.trial ?? {}) as Record<string, unknown>;
  const period = (r.period ?? {}) as Record<string, unknown>;
  const outlets = (r.outlets ?? {}) as Record<string, unknown>;
  const cancel = r.cancellation as Record<string, unknown> | null;
  const payment = r.lastPayment as Record<string, unknown> | null;

  const limit = numberOrNull(outlets.limit);
  const used = Number(numberOrNull(outlets.used) ?? 1);

  return {
    accountId: String(r.accountId ?? ''),
    plan: String(r.plan ?? 'trial'),
    planLabel: planName(String(r.plan ?? 'trial')),
    status: String(r.status ?? 'trialing'),
    pricePaise: numberOrNull(r.pricePaise),
    trial: {
      startedAt: isoOrNull(trial.startedAt),
      endsAt: isoOrNull(trial.endsAt),
      daysRemaining: Number(numberOrNull(trial.daysRemaining) ?? 0),
      running: trial.running === true,
    },
    period: {
      startedAt: isoOrNull(period.startedAt),
      expiresAt: isoOrNull(period.expiresAt),
      endsAt: isoOrNull(period.endsAt),
    },
    cancellation: cancel
      ? {
          requestedAt: String(cancel.requestedAt ?? ''),
          effectiveAt: isoOrNull(cancel.effectiveAt),
          confirmed: cancel.confirmed === true,
        }
      : null,
    outlets: {
      used,
      limit,
      unlimited: limit === null,
      remaining: limit === null ? null : Math.max(limit - used, 0),
    },
    canWrite: r.canWrite === true,
    readOnly: r.readOnly !== false,
    pastDue: r.pastDue === true,
    expired: r.expired === true,
    lastPayment: payment
      ? {
          amountPaise: Number(numberOrNull(payment.amountPaise) ?? 0),
          status: String(payment.status ?? ''),
          paidAt: String(payment.paidAt ?? ''),
          receipt: typeof payment.receipt === 'string' ? payment.receipt : null,
          failureReason: typeof payment.failureReason === 'string' ? payment.failureReason : null,
        }
      : null,
  };
}

/**
 * Load the subscription screen for the caller's restaurant.
 *
 * Returns `unconfigured` when Supabase is not configured: the screen then
 * renders its explanation and nothing else, because a subscription page
 * showing invented prices would be worse than no subscription page.
 */
export async function getSubscriptionScreenData(
  getOutletBar?: () => Promise<OutletBar | null>,
): Promise<SubscriptionScreenResult> {
  const context = await getStaffContextDetailed();
  if (!context.ok) return { ok: false, reason: context.reason };

  const { supabase, restaurantId, role } = context.context;

  const [stateResult, historyResult, paymentsResult] = await Promise.all([
    supabase.rpc('account_subscription_state', { p_restaurant_id: restaurantId }),
    supabase.rpc('account_subscription_history', { p_restaurant_id: restaurantId, p_limit: 50 }),
    supabase.rpc('account_payment_history', { p_restaurant_id: restaurantId, p_limit: 50 }),
  ]);

  const history: SubscriptionEventRow[] = Array.isArray(historyResult.data)
    ? (historyResult.data as Record<string, unknown>[]).map((row) => ({
        id: String(row.id ?? ''),
        kind: String(row.kind ?? ''),
        fromPlan: typeof row.fromPlan === 'string' ? row.fromPlan : null,
        toPlan: typeof row.toPlan === 'string' ? row.toPlan : null,
        amountPaise: numberOrNull(row.amountPaise),
        currency: typeof row.currency === 'string' ? row.currency : null,
        provider: typeof row.provider === 'string' ? row.provider : null,
        actor: String(row.actor ?? 'system'),
        note: typeof row.note === 'string' ? row.note : null,
        occurredAt: String(row.occurredAt ?? ''),
      }))
    : [];

  const payments: PaymentRow[] = Array.isArray(paymentsResult.data)
    ? (paymentsResult.data as Record<string, unknown>[]).map((row) => ({
        id: String(row.id ?? ''),
        plan: String(row.plan ?? ''),
        planLabel: planName(String(row.plan ?? '')),
        amountPaise: Number(numberOrNull(row.amountPaise) ?? 0),
        currency: String(row.currency ?? 'INR'),
        status: (['pending', 'succeeded', 'failed', 'refunded'].includes(String(row.status))
          ? String(row.status)
          : 'pending') as PaymentRow['status'],
        periodStart: isoOrNull(row.periodStart),
        periodEnd: isoOrNull(row.periodEnd),
        paidAt: String(row.paidAt ?? ''),
        provider: typeof row.provider === 'string' ? row.provider : null,
        failureReason: typeof row.failureReason === 'string' ? row.failureReason : null,
        receipt: typeof row.receipt === 'string' ? row.receipt : null,
        receiptId: typeof row.receiptId === 'string' ? row.receiptId : null,
      }))
    : [];

  const outlet = getOutletBar ? await getOutletBar() : null;

  return {
    ok: true,
    outlet,
    data: {
      role,
      state: toState(stateResult.data),
      history,
      payments,
      catalog: PLAN_PRICES,
      providerConfigured: isBillingProviderConfigured(),
    },
  };
}

export type ReceiptResult =
  | { ok: true; receipt: ReceiptRow }
  | { ok: false; reason: 'unconfigured' | 'signed-out' | 'no-membership' | 'not-found' };

/**
 * One receipt, for the account that owns it.
 *
 * The membership check is inside `public.account_receipt()`: a caller from
 * another account gets null, which is the same answer as "no such receipt" —
 * deliberately, because "exists but not yours" is a fact about somebody else's
 * billing.
 */
export async function getSubscriptionReceipt(receiptId: string): Promise<ReceiptResult> {
  const context = await getStaffContextDetailed();
  if (!context.ok) return { ok: false, reason: context.reason };

  const { data, error } = await context.context.supabase.rpc('account_receipt', {
    p_receipt_id: receiptId,
  });

  if (error || !data || typeof data !== 'object') return { ok: false, reason: 'not-found' };

  const row = data as Record<string, unknown>;
  return {
    ok: true,
    receipt: {
      id: String(row.id ?? ''),
      receiptNumber: String(row.receiptNumber ?? ''),
      plan: String(row.plan ?? ''),
      planLabel: String(row.planLabel ?? planName(String(row.plan ?? ''))),
      amountPaise: Number(numberOrNull(row.amountPaise) ?? 0),
      currency: String(row.currency ?? 'INR'),
      periodStart: isoOrNull(row.periodStart),
      periodEnd: isoOrNull(row.periodEnd),
      paidAt: String(row.paidAt ?? ''),
      issuedAt: String(row.issuedAt ?? ''),
      provider: typeof row.provider === 'string' ? row.provider : null,
      accountId: String(row.accountId ?? ''),
      restaurantName: typeof row.restaurantName === 'string' ? row.restaurantName : null,
    },
  };
}
