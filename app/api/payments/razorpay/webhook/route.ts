/**
 * The provider telling us, without a browser, that money moved.
 *
 * WHY THIS EXISTS WHEN THE CHECKOUT CALLBACK ALREADY SETTLES
 *
 * Because the callback needs the guest to come back. A phone that loses signal
 * after paying, a tab closed on the "processing" screen, a guest who walks out
 * mid-redirect: in all three the money is taken and the order still says
 * unpaid. The webhook is the provider's own record, it retries, and it arrives
 * whether or not anyone is looking at the page.
 *
 * THE BODY IS READ AS TEXT, NOT AS JSON
 *
 * The signature covers the bytes. `await request.json()` parses and discards
 * them; re-serialising gives the same object with different whitespace and the
 * signature stops matching — a bug that looks like "the provider is sending
 * bad signatures". So: text first, verify, then parse.
 *
 * STATUS CODES MATTER, AND NOT IN THE USUAL WAY
 *
 * 2xx means "recorded, stop retrying". So a body we do not understand, or an
 * event we do not act on, still gets 200 — otherwise the provider retries for
 * hours over something that will never succeed. A 4xx/5xx is reserved for the
 * two cases where retrying is the right answer: a bad signature (which is not
 * the provider, and is logged loudly) and our own failure to write.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import {
  IGNORED_EVENTS,
  ONLINE_PROVIDER,
  readWebhookPayment,
  SETTLING_EVENTS,
  verifyWebhookSignature,
  webhookConfigured,
  webhookEventName,
} from '@/lib/payments/razorpay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!webhookConfigured() || !isSupabaseAdminConfigured) {
    // Not configured is not a signature failure: nothing can be verified, so
    // nothing is believed. 503 tells the provider to try again later, which is
    // the correct answer while a key is being set up.
    console.error('[razorpay/webhook] no webhook secret configured');
    return NextResponse.json({ ok: false, error: 'Webhook is not configured.' }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!verifyWebhookSignature({ rawBody, signature })) {
    console.error('[razorpay/webhook] signature verification failed');
    return NextResponse.json({ ok: false, error: 'Signature verification failed.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Signed, but not JSON. Nothing to do, and retrying will not help.
    console.error('[razorpay/webhook] signed body was not JSON');
    return NextResponse.json({ ok: true, ignored: 'unparseable' });
  }

  const event = webhookEventName(body);

  if (!(SETTLING_EVENTS as readonly string[]).includes(event)) {
    // A failed payment is not money — acknowledged and dropped on purpose.
    if ((IGNORED_EVENTS as readonly string[]).includes(event)) {
      return NextResponse.json({ ok: true, ignored: event });
    }
    return NextResponse.json({ ok: true, ignored: event || 'unknown' });
  }

  const payment = readWebhookPayment(body);
  if (!payment) {
    console.error('[razorpay/webhook] captured event with an unreadable body', event);
    return NextResponse.json({ ok: true, ignored: 'unreadable' });
  }

  if (!payment.captured) {
    return NextResponse.json({ ok: true, ignored: 'not captured' });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Not configured.' }, { status: 503 });
  }

  const { error } = await admin.rpc('settle_online_payment', {
    p_provider: ONLINE_PROVIDER,
    p_provider_order_ref: payment.providerOrderId,
    p_provider_payment_ref: payment.paymentId,
    // The provider's own number, held to the attempt's amount by the function.
    p_amount_paise: payment.amountPaise,
  });

  if (error) {
    // 500 so the provider retries. The checkout callback has probably already
    // settled this payment; in that case the function returns the existing row
    // and this branch is never reached.
    console.error('[razorpay/webhook] settle failed', { error, order: payment.providerOrderId });
    return NextResponse.json({ ok: false, error: 'Could not record that payment.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settled: payment.providerOrderId });
}
