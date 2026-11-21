import { NextResponse } from 'next/server';
import { JsonInputError, readJsonObject } from '@/lib/http-json';
import { getStaffContextDetailed, KITCHEN_ROLES } from '@/lib/db/staff';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { parseRealtimeSignal, realtimeAlertRateKey } from '@/lib/realtime-alerts';
import { sameOrigin } from '@/lib/outlets';
import { formatIncidentLogLine } from '@/lib/monitoring-incidents';
import { realtimeIncidents } from '@/lib/incident-registry';
import { notifyIncident } from '@/lib/incident-notify';

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
    // The incident tracker deduplicates per server instance; the durable
    // record is the structured log line itself. The dedup key stays in
    // memory and is never logged.
    const key = `kitchen-realtime:${staff.context.restaurantId}`;
    if (signal.kind === 'degraded') {
      const { record, outcome } = realtimeIncidents.report({
        key,
        kind: 'kitchen_realtime_degraded',
        severity: 'warning',
        summary: 'Kitchen realtime delivery degraded',
      });
      console.warn(formatIncidentLogLine(outcome, record));
      // A brand-new failure is worth a push; repeats are deduplicated by the
      // tracker and a resolved incident is not news. Best-effort: the outcome
      // is logged inside notifyIncident either way.
      if (outcome === 'opened' || outcome === 'reopened') {
        await notifyIncident(outcome === 'opened' ? 'incident_opened' : 'incident_reopened', record);
      }
    } else {
      const resolved = realtimeIncidents.resolveByKey(key, 'kitchen-realtime-channel');
      if (resolved) console.info(formatIncidentLogLine('resolved', resolved));
      else console.info(`[autodine:alert] ${JSON.stringify({ event: 'kitchen_realtime_recovered', kind: 'kitchen_realtime_recovered', severity: 'info', durationMs: signal.durationMs })}`);
    }

    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Monitoring is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
