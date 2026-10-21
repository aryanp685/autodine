/**
 * The checkout window came back and says it took money.
 *
 * THE ONLY QUESTION THIS ROUTE ASKS
 *
 * "Is this message really from the payment provider?" The browser posts three
 * values: the provider order id, the payment id, and a signature. The
 * signature is an HMAC over the first two, keyed with our secret. A stranger
 * can make up a payment id; they cannot make up the signature without the
 * secret. So the check below is the whole security model, and everything after
 * it is bookkeeping.
 *
 * WHAT IT DOES NOT TRUST
 *
 * Not the amount (it is not even sent; the database uses the amount recorded
 * when the attempt began), not the order it belongs to (the provider order id
 * is what maps back to ours), and not the fact that this request happened at
 * all (the webhook may have already settled it -- settle_online_payment is
 * idempotent, so the second call is a no-op that returns the same row).
 *
 * WHY fetch() FROM THE CHECKOUT HANDLER RATHER THAN A FORM POST
 *
 * The handler has the three values in hand and no page to navigate to. It
 * posts JSON and shows the guest the answer in place; a full navigation would
 * reload a page whose query string is the guest's credential.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { ONLINE_PROVIDER, onlinePaymentsConfigured, verifyCheckoutSignature } from '@/lib/payments/razorpay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  razorpay_order_id?: unknown;
  razorpay_payment_id?: unknown;
  razorpay_signature?: unknown;
};

export async function POST(request: Request) {
  if (!onlinePaymentsConfigured() || !isSupabaseAdminConfigured) {
    return NextResponse.json(
      { ok: false, error: 'Card payment is not connected on this deployment.' },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'That request could not be read.' }, { status: 400 });
  }

  const orderId = typeof body.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
  const paymentId = typeof body.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
  const signature = typeof body.razorpay_signature === 'string' ? body.razorpay_signature : '';

  if (!orderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: 'That payment is incomplete.' }, { status: 400 });
  }

  if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
    // Deliberately vague to the caller, specific in the log. A guest sees a
    // sentence they can act on; the log keeps the ids for support.
    console.error('[razorpay/verify] signature mismatch', { orderId, paymentId });
    return NextResponse.json(
      {
        ok: false,
        error: 'We could not confirm that payment. If money left your account, show this screen to staff — do not pay again.',
      },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Card payment is not connected.' }, { status: 503 });
  }

  const { data, error } = await admin.rpc('settle_online_payment', {
    p_provider: ONLINE_PROVIDER,
    p_provider_order_ref: orderId,
    p_provider_payment_ref: paymentId,
    // No amount: the database uses the amount the attempt was opened with.
    p_amount_paise: null,
  });

  if (error) {
    console.error('[razorpay/verify] settle failed', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'The payment went through but we could not record it. Show this screen to staff — do not pay again.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, paymentId: typeof data === 'string' ? data : '' });
}
