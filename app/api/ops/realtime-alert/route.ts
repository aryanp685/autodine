import { NextResponse } from 'next/server';
import { JsonInputError, readJsonObject } from '@/lib/http-json';
import { getStaffContextDetailed, KITCHEN_ROLES } from '@/lib/db/staff';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { parseRealtimeSignal, realtimeAlertRateKey } from '@/lib/realtime-alerts';
import { sameOrigin } from '@/lib/outlets';

export const runtime = 'nodejs';

/**
 * Authenticated signal from the kitchen board. This deliberately emits a
 * structured server log entry, not a user-facing toast: a deployment's log
 * alert rule can page on the fixed `autodine:realtime-alert` prefix without
 * exposing restaurant/customer content. No external alert provider is assumed.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return NextResponse.json({ error: 'Cross-origin monitoring request refused.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    const status = error instanceof JsonInputError ? error.status : 400;
    return NextResponse.json({ error: 'Invalid monitoring signal.' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }

  const signal = parseRealtimeSignal(body);
  if (!signal) return NextResponse.json({ error: 'Invalid monitoring signal.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

  try {
    const staff = await getStaffContextDetailed();
    if (!staff.ok) {
      const status = staff.reason === 'unconfigured' ? 503 : staff.reason === 'signed-out' ? 401 : 403;
      return NextResponse.json({ error: 'Kitchen staff sign-in is required.' }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!KITCHEN_ROLES.includes(staff.context.role)) {
      return NextResponse.json({ error: 'Kitchen staff permission is required.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: 'Monitoring is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const { data, error } = await admin.rpc('hit_rate_limit', {
      p_key: realtimeAlertRateKey(staff.context.restaurantId),
      p_limit: 6,
      p_window_seconds: 600,
    });
    if (error || !data?.[0]) return NextResponse.json({ error: 'Monitoring is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    if (!data[0].allowed) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

    // Intentionally omit tenant/user identifiers, URLs and free-form error
    // text. Alert rules can match the stable event and severity fields only.
    const entry = JSON.stringify({
      event: signal.kind === 'degraded' ? 'kitchen_realtime_degraded' : 'kitchen_realtime_recovered',
      severity: signal.kind === 'degraded' ? 'alert' : 'info',
      durationMs: signal.durationMs,
    });
    if (signal.kind === 'degraded') console.warn(`[autodine:realtime-alert] ${entry}`);
    else console.info(`[autodine:realtime-alert] ${entry}`);

    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Monitoring is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
