/**
 * Brevo transactional delivery webhook receiver.
 *
 * SECURITY MODEL (Brevo signs nothing — there is no HMAC to check):
 *   1. NO SECRET, NO PROCESSING. Without `BREVO_WEBHOOK_SECRET` this answers
 *      503 and records nothing, like every other fail-closed boundary here.
 *   2. THE CALLER MUST CARRY THE SECRET. Brevo's webhook auth settings send
 *      either a bearer token or a custom header; both are checked in
 *      constant time (lib/email/brevo-webhook.ts). Anything else is a 401
 *      with one generic sentence.
 *   3. EVENTS ARE OBSERVATIONS, NEVER AUTHORIZATION. A delivered/bounce/spam
 *      event moves only tenant-free telemetry counters and the in-memory
 *      incident registry (deduped by fixed key). It cannot change an account,
 *      a membership or a bill, so a forged event that somehow passed the
 *      secret could at worst raise a spurious warning a human acknowledges.
 *   4. NOTHING PERSONAL SURVIVES. The recipient, subject, link and message id
 *      in Brevo's payload are discarded by the parser; the log line carries
 *      only the fixed event word and classification.
 */

import { NextResponse } from 'next/server';

import { parseBrevoWebhookEvent, verifyBrevoWebhookCredential } from '@/lib/email/brevo-webhook';
import { recordDelivery } from '@/lib/delivery-telemetry';
import { formatIncidentLogLine } from '@/lib/monitoring-incidents';
import { operationalIncidents } from '@/lib/incident-registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 64 * 1024;
const GENERIC_REFUSAL = { error: 'Webhook refused' };

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Fail closed while no webhook secret is configured.
  const secret = process.env.BREVO_WEBHOOK_SECRET?.trim() ?? '';
  if (!secret) {
    return NextResponse.json({ error: 'Email webhook is not configured' }, { status: 503 });
  }

  // 2. The caller must prove it is the configured Brevo webhook.
  const authorized = verifyBrevoWebhookCredential(
    {
      authorization: request.headers.get('authorization'),
      customSecret: request.headers.get('x-autodine-webhook-secret'),
    },
    secret,
  );
  if (!authorized) {
    return NextResponse.json(GENERIC_REFUSAL, { status: 401 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json(GENERIC_REFUSAL, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(GENERIC_REFUSAL, { status: 400 });
  }

  const classified = parseBrevoWebhookEvent(payload);
  if (!classified) {
    return NextResponse.json(GENERIC_REFUSAL, { status: 400 });
  }

  if (classified.action === 'delivered') {
    recordDelivery('email', 'delivered', 0);
  } else if (classified.action === 'failed' && classified.incidentKind && classified.severity) {
    recordDelivery('email', 'failed', 0);
    // Deduped by a fixed key per failure class: a bounce storm becomes one
    // incident with a rising count, and the key never leaves memory.
    const { record, outcome } = operationalIncidents.report({
      key: `brevo-webhook:${classified.event}`,
      kind: classified.incidentKind,
      severity: classified.severity,
      summary:
        classified.incidentKind === 'email_spam_complaint'
          ? 'A recipient reported AutoDine email as spam (Brevo webhook)'
          : 'Brevo reported a permanent email delivery failure',
    });
    console.warn(formatIncidentLogLine(outcome, record));
  }

  console.info(
    `[autodine:email] ${JSON.stringify({
      event: 'brevo_webhook',
      webhookEvent: classified.event,
      outcome: classified.action,
    })}`,
  );
  return NextResponse.json({ received: true, event: classified.event, outcome: classified.action });
}

/** A GET is refused with 405 rather than a friendly page. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
