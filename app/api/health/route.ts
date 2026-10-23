import { NextResponse } from 'next/server';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase/env';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { probeHealth, type ProbeClient } from '@/lib/health';
import { BILLING } from '@/lib/plans';
import { onlinePaymentsConfigured } from '@/lib/payments/razorpay';

/**
 * GET /api/health
 *
 * "Is this deployment wired up, and are the migrations on it?"
 *
 * Public on purpose: it is the one question that has no answer on screen and
 * costs a support conversation when it is wrong. Everything it returns is a
 * boolean or a fixed word -- no keys, no ids, no restaurant names, no counts,
 * no database error text.
 *
 * It never caches: the entire point is to check the current state after a
 * deploy or a migration, and a cached "missing" would be worse than no endpoint.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  // The browser-safe client is enough to read columns (RLS allows nothing of a
  // stranger's) and is explicitly granted plan_features(). The admin client is
  // used only when it exists, because a column read is then never filtered by a
  // policy that happens to be stricter than the schema.
  const admin = getSupabaseAdmin();
  const server = admin ?? (await createSupabaseServerClient());

  const health = await probeHealth({
    configured: isSupabaseConfigured,
    serverKey: isSupabaseAdminConfigured,
    gatewayKeys: onlinePaymentsConfigured(),
    trialDays: BILLING.trialDays,
    primary: (server as unknown as ProbeClient | null) ?? null,
    publicClient: (await createSupabaseServerClient()) as unknown as ProbeClient | null,
  });

  // "ok" means every migration this build expects is present. A deployment with
  // no database at all is not "ok" -- it renders sample data, and pretending
  // otherwise is how a demo ends with a fictional order.
  const ok = health.configured && health.schema.trialAndWriteGate === 'applied';

  return NextResponse.json(
    { ok, ...health, checkedAt: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } }
  );
}
