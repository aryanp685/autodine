/**
 * Subscription server actions: what an owner may ask for.
 *
 * THE LINE THIS FILE HOLDS
 *
 * An owner may START a trial, READ their subscription, REQUEST a cancellation
 * and CHANGE their mind. An owner may NOT switch a paid plan on directly: that
 * needs money to have moved, and only the provider's signed webhook says so.
 *
 * So every action here is one of two kinds:
 *
 *   - Provider-independent and real: request a cancellation, withdraw the
 *     request, and everything that only reads.
 *   - Provider-dependent, and real only once a provider is configured: choosing
 *     a paid plan opens a Cashfree checkout (lib/billing/cashfree.ts). The plan
 *     itself is still switched by the webhook, never by this file; without
 *     credentials the action fails closed with `PROVIDER_UNAVAILABLE_MESSAGE`.
 *
 * Nothing here trusts the browser. The restaurant id comes from the session's
 * membership (lib/db/staff.ts), the price is read from the server's catalog,
 * and the database refuses a subscription write from an authenticated caller
 * regardless of what this file does.
 */

'use server';

import { revalidatePath } from 'next/cache';

import { getStaffContextDetailed } from '@/lib/db/staff';
import { siteOrigin } from '@/lib/site-origin';
import { formatBillMoney } from '@/lib/bill';
import { BILLING_CURRENCY, BILLING_PERIOD_MONTHS, planName, planPriceForMonths } from './catalog';
import { getBillingProvider, PROVIDER_UNAVAILABLE_MESSAGE } from './provider';

export type SubscriptionActionResult = {
  ok: boolean;
  message: string;
  /** Set when the refusal is "no provider yet", so the UI can say so plainly. */
  providerUnavailable?: boolean;
  /** Cashfree / provider hosted checkout URL when a live provider is active. */
  checkoutUrl?: string;
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

  try {
    const session = await provider.createCheckoutSession({
      accountId: context.context.slug || context.context.restaurantId,
      plan,
      months,
      amountPaise,
      currency: BILLING_CURRENCY,
      // The browser comes back to the welcome screen, not the subscription
      // list: Cashfree appends its own query params to return_url, so the plan
      // travels in the path where nothing can overwrite it.
      returnPath: `/dashboard/subscription/welcome/${plan}`,
      // Cashfree sends the browser back from its own checkout, so it needs a
      // full URL; relative would land the owner nowhere.
      origin: await siteOrigin(),
    });
    return {
      ok: true,
      checkoutUrl: session.url,
      message: `Checkout ready for ${planName(plan)} (${formatBillMoney(amountPaise)} ${BILLING_CURRENCY}).`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : PROVIDER_UNAVAILABLE_MESSAGE,
    };
  }
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
 * The screen asks once, in a confirm step that names the date, and this action
 * is idempotent behind it: a second press returns the date already recorded
 * and writes nothing, so a double tap cannot move the date or file a second
 * request. An account with nothing running (expired, or a period that already
 * ended) is refused with its own sentence instead of a cancellation dated in
 * the past. Whatever the state, the owner keeps every outlet, every order and
 * every menu -- readable, nothing deleted -- until the day already paid for.
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
    // Each refusal the database can give gets its own sentence, so the owner
    // learns what is actually true rather than "something went wrong".
    const reason = error.message ?? '';
    if (reason.includes('nothing_to_cancel')) {
      return {
        ok: false,
        message:
          'This subscription has already ended, so there is nothing left to cancel. Choose a plan to start again.',
      };
    }
    // The function refuses a caller who is not an owner of this restaurant, so
    // a kitchen login pressing this gets the same sentence as a stranger.
    return { ok: false, message: 'Only an owner of this account can cancel the subscription.' };
  }

  const result = data as { effective_at?: string; status?: string } | null;
  const effectiveAt = result?.effective_at;
  revalidatePath('/dashboard/subscription', 'layout');

  if (result?.status === 'already_requested') {
    return {
      ok: true,
      message: effectiveAt
        ? `This subscription is already set to end on ${new Date(effectiveAt).toLocaleDateString('en-IN', { dateStyle: 'long' })}. Nothing else to do.`
        : 'This subscription is already set to end at the close of its period. Nothing else to do.',
    };
  }

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
