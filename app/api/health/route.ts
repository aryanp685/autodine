import { NextResponse } from 'next/server';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase/env';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { probeHealth, probeOperationalSchema, isReady, type ProbeClient } from '@/lib/health';
import { BILLING } from '@/lib/plans';
import { formatHealthAlertLine } from '@/lib/monitoring-incidents';

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
    trialDays: BILLING.trialDays,
    primary: (server as unknown as ProbeClient | null) ?? null,
    publicClient: (await createSupabaseServerClient()) as unknown as ProbeClient | null,
  });

  const operational = await probeOperationalSchema((server as unknown as ProbeClient | null) ?? null);
  const ok = isReady(health, operational);

  // Application failure path -> structured, fixed-vocabulary alert line.
  // Provider-independent: a log drain can page on `[autodine:alert]` +
  // event `health_check_failed`. No keys, ids or tenant data are emitted.
  if (!ok) {
    console.warn(formatHealthAlertLine({
      configured: health.configured,
      serverKey: health.serverKey,
      reachable: health.reachable,
      credentials: health.credentials,
      credentialProbe: health.credentialProbe,
      schema: { ...health.schema, ...operational },
    }));
  }

  return NextResponse.json(
    { ok, ...health, operational, checkedAt: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } }
  );
}
