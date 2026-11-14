/**
 * Subscription server actions: what an owner may ask for.
 *
 * THE LINE THIS FILE HOLDS
 *
 * An owner may START a trial, READ their subscription, REQUEST a cancellation
 * and CHANGE their mind. An owner may NOT switch a paid plan on: that needs
 * money to have moved, and nothing in this deployment can move money.
 *
 * So every action here is one of two kinds:
 *
 *   - Provider-independent and real: request a cancellation, withdraw the
 *     request, and everything that only reads.
 *   - Provider-dependent and REFUSED: choosing a paid plan. Those return
 *     `PROVIDER_UNAVAILABLE_MESSAGE` and record nothing. They are written out
 *     in full rather than left as a TODO, so the day a provider is configured
 *     the change is one line: call the provider instead of returning early.
 *
 * Nothing here trusts the browser. The restaurant id comes from the session's
 * membership (lib/db/staff.ts), the price is read from the server's catalog,
 * and the database refuses a subscription write from an authenticated caller
 * regardless of what this file does.
 */

'use server';

import { revalidatePath } from 'next/cache';

import { getStaffContextDetailed } from '@/lib/db/staff';
import { formatBillMoney } from '@/lib/bill';
import { BILLING_CURRENCY, BILLING_PERIOD_MONTHS, planName, planPriceForMonths } from './catalog';
import { getBillingProvider, PROVIDER_UNAVAILABLE_MESSAGE } from './provider';

export type SubscriptionActionResult = {
  ok: boolean;
  message: string;
  /** Set when the refusal is "no provider yet", so the UI can say so plainly. */
  providerUnavailable?: boolean;
};

/**
 * Choose a paid plan.
 *
 * Today this ALWAYS refuses, and says why. It is the honest shape of the
 * feature: the plan, the price and the outlet limit are all known, the
 * checkout is not. No session is created, nothing is recorded as a sale, and
 * no plan is activated on an unverified request.
 */
export async function choosePlanAction(plan: string): Promise<SubscriptionActionResult> {
  const context = await getStaffContextDetailed();
  if (!context.ok) {
    return { ok: false, message: 'Sign in to change your plan.' };
  }
  if (context.context.role !== 'owner') {
    return { ok: false, message: 'Only an owner of this account can change the plan.' };
  }

  if (!['starter', 'professional', 'business'].includes(plan)) {
    return { ok: false, message: 'That is not a plan.' };
  }

  const months = BILLING_PERIOD_MONTHS;
  const amountPaise = planPriceForMonths(plan, months);
  if (amountPaise === null) {
    return { ok: false, message: 'That plan has no price.' };
  }

  const provider = getBillingProvider();
  if (!provider) {
    // Fail closed, and say what is true. The owner pressed a price, so the
    // answer repeats it: the figure is approved, the checkout is not, and the
    // trial keeps running in the meantime.
    return {
      ok: false,
      providerUnavailable: true,
      message: `${PROVIDER_UNAVAILABLE_MESSAGE} ${planName(plan)} is ${formatBillMoney(amountPaise)} ${BILLING_CURRENCY} a month when it is switched on.`,
    };
  }

  // A provider exists from here on. The checkout session is created with the
  // server's own amount and currency — never an amount the browser offered —
  // and the plan is only activated when the provider's webhook says the money
  // arrived.
  //
  //   const session = await provider.createCheckoutSession({
  //     accountId: context.context.restaurantId, plan, months, amountPaise,
  //     currency: BILLING_CURRENCY, returnPath: '/dashboard/subscription',
  //   });
  //   redirect(session.url);
  return { ok: false, message: PROVIDER_UNAVAILABLE_MESSAGE, providerUnavailable: true };
}

/**
 * Withdraw a cancellation request.
 *
 * The reverse of `requestCancellationAction` and only possible while the
 * subscription is still inside its period: it clears the request and the
 * account keeps working.
 */
export async function withdrawCancellationAction(): Promise<SubscriptionActionResult> {
  const context = await getStaffContextDetailed();
  if (!context.ok) {
    return { ok: false, message: 'Sign in to manage your subscription.' };
  }
  if (context.context.role !== 'owner') {
    return { ok: false, message: 'Only an owner of this account can manage the subscription.' };
  }

  const { data, error } = await context.context.supabase.rpc('withdraw_subscription_cancellation', {
    p_restaurant_id: context.context.restaurantId,
  });

  if (error) {
    return { ok: false, message: 'The cancellation request could not be withdrawn. Try again.' };
  }
  if (!data) {
    return { ok: false, message: 'There is no cancellation request to withdraw.' };
  }

  revalidatePath('/dashboard/subscription', 'layout');
  return { ok: true, message: 'Your cancellation request was withdrawn. Nothing changes on your renewal date.' };
}

/**
 * Ask for the subscription to stop at the end of the period.
 *
 * The owner is not asked to confirm twice, but they are told exactly what they
 * keep: every outlet, every order, every menu — readable, nothing deleted —
 * until the end of the period already paid for.
 */
export async function requestCancellationAction(): Promise<SubscriptionActionResult> {
  const context = await getStaffContextDetailed();
  if (!context.ok) {
    return { ok: false, message: 'Sign in to manage your subscription.' };
  }
  if (context.context.role !== 'owner') {
    return { ok: false, message: 'Only an owner of this account can manage the subscription.' };
  }

  const { data, error } = await context.context.supabase.rpc('request_subscription_cancellation', {
    p_restaurant_id: context.context.restaurantId,
  });

  if (error) {
    // The function refuses a caller who is not an owner of this restaurant, so
    // a kitchen login pressing this gets the same sentence as a stranger.
    return { ok: false, message: 'Only an owner of this account can cancel the subscription.' };
  }

  const effectiveAt = (data as { effective_at?: string } | null)?.effective_at;
  revalidatePath('/dashboard/subscription', 'layout');

  return {
    ok: true,
    message: effectiveAt
      ? `Cancellation requested. Every outlet and every row of data stays readable until ${new Date(effectiveAt).toLocaleDateString('en-IN', { dateStyle: 'long' })}.`
      : 'Cancellation requested. Every outlet and every row of data stays readable until the end of your period.',
  };
}

/**
 * Retry a failed payment.
 *
 * Also refused while no provider is configured: there is no mandate to charge
 * and nothing to retry. The account keeps whatever access its period allows.
 */
export async function retryPaymentAction(): Promise<SubscriptionActionResult> {
  const context = await getStaffContextDetailed();
  if (!context.ok) {
    return { ok: false, message: 'Sign in to manage your subscription.' };
  }
  if (context.context.role !== 'owner') {
    return { ok: false, message: 'Only an owner of this account can manage the subscription.' };
  }

  if (!getBillingProvider()) {
    return { ok: false, message: PROVIDER_UNAVAILABLE_MESSAGE, providerUnavailable: true };
  }

  // With a provider configured this asks it to charge the saved mandate again.
  // The plan is only extended when the provider confirms the money.
  return { ok: false, message: PROVIDER_UNAVAILABLE_MESSAGE, providerUnavailable: true };
}
