/**
 * Billing webhook: the only path that may switch a paid plan on.
 *
 * A webhook is a stranger with a signature. The order here is the security
 * model, and it is not negotiable:
 *
 *   1. NO PROVIDER, NO PROCESSING. While no provider is configured this
 *      answers 503 and records nothing. A deployment with no billing provider
 *      has no reason to accept a billing event, and an accepted event is a
 *      free subscription.
 *   2. THE RAW BODY IS VERIFIED, THEN PARSED. Reading the body as text and
 *      verifying the HMAC over those exact bytes first is what stops a payload
 *      that parses differently than it signed.
 *   3. THE SIGNATURE MUST BE VALID AND FRESH. Constant-time compare, and a
 *      five-minute window, so a copied request expires.
 *   4. THE EVENT IS RECORDED BEFORE IT IS ACTED ON. The unique key on
 *      (provider, event id) is the replay protection: a second delivery of the
 *      same event inserts nothing and changes nothing.
 *   5. THE AMOUNT MUST BE THE APPROVED PRICE. Checked here against the
 *      catalog, and again inside record_subscription_payment(). Signed is not
 *      the same as correct.
 *
 * Nothing here activates a plan on a client request. The plan changes only
 * when this route, the database function and the amount check all agree.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isSupabaseAdminConfigured } from '@/lib/supabase/env';
import { billingWebhookSecret, BILLING_PROVIDER_ENV } from '@/lib/billing/provider';
import {
  parseBillingEvent,
  payloadDigest,
  providerEventIdOf,
  validateBillingEvent,
  verifyWebhookHeaders,
} from '@/lib/billing/webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Nothing about a failed webhook is a secret, and nothing about it is public. */
const GENERIC_FAILURE = { error: 'Webhook refused' };

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Fail closed. An unconfigured deployment does not process billing events.
  const providerName = (process.env[BILLING_PROVIDER_ENV] ?? '').trim();
  const secret = billingWebhookSecret();
  if (!providerName || !secret || !isSupabaseAdminConfigured) {
    return NextResponse.json({ error: 'Billing provider is not configured' }, { status: 503 });
  }

  // 2. The exact bytes that were signed.
  const rawBody = await request.text();

  // 3. Signature and freshness.
  const verification = verifyWebhookHeaders({
    rawBody,
    headers: Object.fromEntries(request.headers.entries()),
    secret,
  });
  if (!verification.ok) {
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  const event = parseBillingEvent(payload);
  if (!event) {
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  // 4. Replay protection: the event is recorded before it is acted on.
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: 'Billing provider is not configured' }, { status: 503 });
  }

  const { error: eventError } = await supabase.from('billing_webhook_events').insert({
    provider: providerName,
    provider_event_id: event.id,
    event_type: event.type,
    payload_digest: payloadDigest(rawBody),
    signature_ok: true,
    outcome: 'received',
  });

  if (eventError) {
    // A duplicate key is the same event arriving twice: not an error, and
    // definitely not a second payment.
    if (/duplicate key|unique/i.test(eventError.message)) {
      return NextResponse.json({ status: 'duplicate', eventId: event.id }, { status: 200 });
    }
    return NextResponse.json(GENERIC_FAILURE, { status: 500 });
  }

  // 5. The amount must be the approved price, in the approved currency.
  const validation = validateBillingEvent(event);
  if (!validation.ok) {
    await supabase
      .from('billing_webhook_events')
      .update({ outcome: `refused:${validation.error}` })
      .eq('provider', providerName)
      .eq('provider_event_id', event.id);
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  const outcome = await dispatch(event, providerName);
  if (!outcome.ok) {
    await supabase
      .from('billing_webhook_events')
      .update({ outcome: `failed:${outcome.error}` })
      .eq('provider', providerName)
      .eq('provider_event_id', event.id);
    return NextResponse.json(GENERIC_FAILURE, { status: 502 });
  }

  await supabase
    .from('billing_webhook_events')
    .update({ outcome: `applied:${event.status}` })
    .eq('provider', providerName)
    .eq('provider_event_id', event.id);

  return NextResponse.json({ status: 'ok', eventId: event.id, result: outcome.result }, { status: 200 });
}

type DispatchResult = { ok: true; result: unknown } | { ok: false; error: string };

/** Hand one validated event to the database. The database re-checks it all. */
async function dispatch(
  event: NonNullable<ReturnType<typeof parseBillingEvent>>,
  providerName: string,
): Promise<DispatchResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: 'not-configured' };

  // The runtime shape of validateBillingEvent()'s guarantee, restated so the
  // compiler can see it too: a payment is never recorded without knowing which
  // account it is for, and a succeeded payment never without an amount.
  if (!event.restaurantName) return { ok: false, error: 'missing-reference' };
  if (event.status === 'succeeded' && event.amountPaise === null) return { ok: false, error: 'missing-amount' };

  if (event.status === 'succeeded') {
    const { data, error } = await supabase.rpc('record_subscription_payment', {
      p_restaurant_name: event.restaurantName,
      p_provider: providerName,
      p_provider_event_id: event.id,
      p_plan: event.plan ?? '',
      p_amount_paise: event.amountPaise ?? 0,
      p_currency: event.currency ?? 'INR',
      p_months: event.months,
      p_occurred_at: event.occurredAt ?? new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: data };
  }

  if (event.status === 'failed') {
    const { data, error } = await supabase.rpc('record_subscription_payment_failure', {
      p_restaurant_name: event.restaurantName,
      p_provider: providerName,
      p_provider_event_id: event.id,
      p_plan: event.plan ?? undefined,
      p_amount_paise: event.amountPaise ?? undefined,
      p_reason: event.failureReason ?? undefined,
      p_occurred_at: event.occurredAt ?? new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: data };
  }

  if (event.status === 'refunded') {
    const { data, error } = await supabase.rpc('record_subscription_refund', {
      p_restaurant_name: event.restaurantName,
      p_provider: providerName,
      p_provider_event_id: event.id,
      p_reference: event.reference ?? undefined,
      p_occurred_at: event.occurredAt ?? new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: data };
  }

  return { ok: false, error: 'unknown-status' };
}

/**
 * A GET is refused with 405 rather than a friendly page.
 *
 * There is nothing to read here and no state to leak about whether billing is
 * switched on.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

/** Only used by the tests to prove the replay key comes from the payload. */
export const __replayKeyOf = providerEventIdOf;
