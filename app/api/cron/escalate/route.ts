import { NextResponse } from 'next/server';

import { realtimeIncidents } from '@/lib/incident-registry';
import { notifyIncident } from '@/lib/incident-notify';
import { formatIncidentLogLine, IncidentTransitionError } from '@/lib/monitoring-incidents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/escalate
 *
 * The scheduled half of alerting: any incident that has been open, never
 * acknowledged, for longer than STALE_MS is escalated to critical and pushed
 * to the alert webhook (when configured). Vercel Cron calls this with
 * `Authorization: Bearer <CRON_SECRET>`; any external HTTPS scheduler may
 * call it the same way. Cadence-agnostic — the Vercel schedule declared in
 * vercel.json is daily (Hobby-plan limit); a Pro plan or an external cron
 * service is required for tighter cadence.
 *
 * FAIL CLOSED
 *
 * No cron secret configured → 503. Wrong or missing secret → 401. There is no
 * unauthenticated path to trigger notifications.
 *
 * SCOPE
 *
 * In-memory per instance: this escalates what THIS instance has open. That is
 * why the durable record stays the structured log line, and why tighter cadence
 * needs a Pro plan or an external scheduler rather than cleverer logic here.
 * No tenant data leaves the process; the webhook payload is the fixed incident
 * vocabulary.
 */
const STALE_MS = 15 * 60 * 1000;

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
    return NextResponse.json({ error: 'Scheduled escalation is not configured on this deployment.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const stale = realtimeIncidents.staleOpen(STALE_MS);
  let escalated = 0;
  for (const incident of stale) {
    try {
      const { record, outcome } = realtimeIncidents.escalate(incident.incidentId, 'cron');
      if (outcome !== 'escalated') continue;
      escalated += 1;
      console.warn(formatIncidentLogLine('escalated', record));
      await notifyIncident('incident_escalated', record);
    } catch (error) {
      if (error instanceof IncidentTransitionError) continue; // resolved between list and escalate
      throw error;
    }
  }

  return NextResponse.json({ scanned: stale.length, escalated, staleAfterMinutes: STALE_MS / 60000 }, { headers: { 'Cache-Control': 'no-store' } });
}
