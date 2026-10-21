'use server';

/**
 * Starting an online payment.
 *
 * WHY THIS IS A SERVER ACTION AND NOT A FETCH FROM THE BROWSER
 *
 * The browser must not be able to say what anything costs, and it must not be
 * able to say "this order is paid". Both of those live behind this file: the
 * amount comes from public_online_due(), which reads public.orders; the
 * provider order is created with that amount; and the row it makes is only a
 * *pending attempt*. It becomes money in app/api/payments/razorpay/verify,
 * after a signature check.
 *
 * WHY THE SERVICE ROLE
 *
 * begin_online_payment is granted to service_role only. A signed-out guest has
 * no session to authorise with, and giving anon EXECUTE would let anyone with
 * an order id open payment attempts against it. The guest's own credential --
 * the token in their confirmation link -- is what this passes, and the function
 * checks it before writing.
 *
 * WHAT THE GUEST GETS BACK
 *
 * Everything the checkout window needs: the publishable key id, the provider's
 * order id, and the amount. The key id is public by design; the secret is
 * never in this response, and never in the browser.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase/env';
import { MIN_ONLINE_PAISE, ONLINE_PROVIDER, createRazorpayOrder, onlinePaymentsConfigured, razorpayKeyId } from '@/lib/payments/razorpay';

export type StartPaymentResult =
  | {
      ok: true;
      keyId: string;
      providerOrderId: string;
      amountPaise: number;
      restaurantName: string;
      orderCode: string;
    }
  | { ok: false; error: string };

type DuePayload = {
  order_id?: unknown;
  code?: unknown;
  restaurant_name?: unknown;
  enabled?: unknown;
  payment_status?: unknown;
  due_paise?: unknown;
};

export async function startOnlinePaymentAction(
  slug: string,
  code: string,
  token: string,
): Promise<StartPaymentResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Ordering is not available right now.' };

  // No key: say so plainly. A button that opens a checkout window which can
  // never be verified is worse than no button.
  if (!onlinePaymentsConfigured()) {
    return { ok: false, error: 'Card payment is not connected on this deployment. Please pay at the counter.' };
  }

  if (!isSupabaseAdminConfigured) {
    return { ok: false, error: 'Card payment is not connected on this deployment. Please pay at the counter.' };
  }

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Card payment is not connected on this deployment. Please pay at the counter.' };

  const cleanSlug = String(slug ?? '').trim();
  const cleanCode = String(code ?? '').trim();
  const cleanToken = String(token ?? '').trim();
  if (!cleanSlug || !cleanCode || !cleanToken) {
    return { ok: false, error: 'Open this page from the link you were given after ordering.' };
  }

  const { data, error } = await admin.rpc('public_online_due', {
    p_slug: cleanSlug,
    p_code: cleanCode,
    p_token: cleanToken,
  });

  if (error) {
    console.error('[startOnlinePaymentAction] due lookup failed', error);
    return { ok: false, error: 'We could not read this order. Please pay at the counter.' };
  }

  if (!data) {
    return { ok: false, error: 'This order could not be found. Please pay at the counter.' };
  }

  const due = data as DuePayload;
  const orderId = typeof due.order_id === 'string' ? due.order_id : '';
  const amountPaise = typeof due.due_paise === 'number' ? due.due_paise : Number(due.due_paise ?? 0);
  const restaurantName = typeof due.restaurant_name === 'string' ? due.restaurant_name : '';

  if (!orderId) {
    return { ok: false, error: 'This order could not be found. Please pay at the counter.' };
  }

  if (due.enabled !== true) {
    return { ok: false, error: 'This restaurant takes payment at the counter.' };
  }

  if (due.payment_status !== 'pending' || amountPaise <= 0) {
    return { ok: false, error: 'This order is already settled.' };
  }

  // The provider's minimum is ₹1. Below it, the honest answer is the counter.
  if (amountPaise < MIN_ONLINE_PAISE) {
    return { ok: false, error: 'That amount is too small for a card payment. Please pay at the counter.' };
  }

  const providerOrder = await createRazorpayOrder({
    amountPaise,
    receipt: cleanCode,
    notes: { order_code: cleanCode, restaurant: restaurantName },
  });

  if (!providerOrder.ok) return { ok: false, error: providerOrder.reason };

  /**
   * Attach the attempt. If this fails the provider has an order that we have
   * no record of -- so the guest is told to pay at the counter rather than
   * being sent into a checkout window whose payment we could not settle.
   */
  const { error: beginError } = await admin.rpc('begin_online_payment', {
    p_provider: ONLINE_PROVIDER,
    p_provider_order_ref: providerOrder.id,
    p_slug: cleanSlug,
    p_order_id: orderId,
    p_guest_token: cleanToken,
    p_amount_paise: amountPaise,
  });

  if (beginError) {
    console.error('[startOnlinePaymentAction] begin failed', beginError);
    const readable = /not switched on/i.test(beginError.message)
      ? 'This restaurant takes payment at the counter.'
      : 'We could not start that payment. Please pay at the counter.';
    return { ok: false, error: readable };
  }

  return {
    ok: true,
    keyId: razorpayKeyId(),
    providerOrderId: providerOrder.id,
    amountPaise,
    restaurantName,
    orderCode: cleanCode,
  };
}
