import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/subscription-expiry
 *
 * The scheduled half of a subscription ending. Cancelling stops the renewal;
 * this job is what marks the account expired once the day it paid for is gone:
 * public.expire_subscriptions() (migration 20261110001100, section 13) flips
 * the status and writes the history event, and touches nothing else -- no
 * outlet, order, menu or table is removed.
 *
 * ACCESS NEVER WAITS FOR THIS JOB
 *
 * public.account_can_write compares the period's end with the clock, so a late
 * or missed run costs accuracy in the record, never a free day of writing.
 * That is also why the schedule below is daily: it keeps the history honest
 * within a day without pretending it is the gate.
 *
 * FAIL CLOSED
 *
 * No cron secret configured -> 503. Wrong or missing secret -> 401. No
 * unauthenticated path runs the sweep. Vercel Cron calls this with
 * `Authorization: Bearer <CRON_SECRET>`; any external HTTPS scheduler may call
 * it the same way.
 */

function authorized(request: Request): boolean {
  const secret = process.env.AUTODINE_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim() || '';
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  // Constant-time-ish comparison without leaking length through early exit.
  if (token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request): Promise<Response> {
  const configured = Boolean(process.env.AUTODINE_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim());
  if (!configured) {
    return NextResponse.json(
      { error: 'Scheduled subscription expiry is not configured on this deployment.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: 'The database is not configured on this deployment.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { data, error } = await admin.rpc('expire_subscriptions');
  if (error) {
    return NextResponse.json(
      { error: 'The expiry sweep failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json({ expired: data ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
}
