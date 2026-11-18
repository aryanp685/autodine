import { NextResponse } from 'next/server';

import { JsonInputError, readJsonObject } from '@/lib/http-json';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { sameOrigin } from '@/lib/outlets';
import {
  formatIncidentLogLine,
  IncidentTransitionError,
  type IncidentRecord,
} from '@/lib/monitoring-incidents';
import { realtimeIncidents } from '@/lib/incident-registry';
import { notifyIncident } from '@/lib/incident-notify';
import { snapshotDeliveryTelemetry } from '@/lib/delivery-telemetry';

export const runtime = 'nodejs';

/**
 * Ops incident read/acknowledge/resolve for this server instance.
 *
 * WHO IT IS FOR
 *
 * Owners and managers — the people responsible for the restaurant. Kitchen
 * and counter roles get the same 403 a stranger gets; acknowledging an
 * incident is an operations decision, not a board action.
 *
 * DELIVERY
 *
 * Every mutation (acknowledge, resolve, escalate) also POSTs a fixed-shape,
 * tenant-free payload to AUTODINE_ALERT_WEBHOOK when one is configured —
 * best-effort, bounded retry, outcome logged, never blocking the response.
 * With no webhook set, behaviour is exactly what it was: the structured log
 * line is the durable record. The registry is in-memory per instance, so an
 * incident opened on one instance is not visible on another — 404 for an
 * unknown id means exactly that.
 *
 * The list carries the same fixed, tenant-free shape the log lines carry.
 */
const MANAGER_ROLES = ['owner', 'manager'];

const ACTIONS = new Set(['list', 'acknowledge', 'resolve', 'escalate']);

/** What staff may see. Ids/timestamps/counts/fixed vocabulary only. */
function present(record: IncidentRecord) {
  return {
    incidentId: record.incidentId,
    kind: record.kind,
    severity: record.severity,
    state: record.state,
    count: record.count,
    summary: record.summary,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    acknowledgedBy: record.acknowledgedBy,
    acknowledgedAt: record.acknowledgedAt,
    resolvedBy: record.resolvedBy,
    resolvedAt: record.resolvedAt,
    escalatedAt: record.escalatedAt,
    escalatedBy: record.escalatedBy,
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return NextResponse.json({ error: 'Cross-origin monitoring request refused.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    const status = error instanceof JsonInputError ? error.status : 400;
    return NextResponse.json({ error: 'Invalid monitoring request.' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Invalid monitoring action.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const staff = await getStaffContextDetailed();
    if (!staff.ok) {
      const status = staff.reason === 'unconfigured' ? 503 : staff.reason === 'signed-out' ? 401 : 403;
      return NextResponse.json({ error: 'Owner or manager sign-in is required.' }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!MANAGER_ROLES.includes(staff.context.role)) {
      return NextResponse.json({ error: 'Owner or manager permission is required.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'list') {
      const incidents = realtimeIncidents.list().map(present);
      // Per-instance delivery counters (tenant-free fixed vocabulary), so a
      // webhook or provider that started failing is visible without tailing
      // logs. Other instances counters are their own; the log is the record.
      const telemetry = snapshotDeliveryTelemetry();
      return NextResponse.json({ incidents, telemetry }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const incidentId = typeof body.incidentId === 'string' ? body.incidentId.trim() : '';
    if (!incidentId || incidentId.length > 120) {
      return NextResponse.json({ error: 'An incident id is required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const who = staff.context.role; // fixed vocabulary; never a user identifier
    try {
      if (action === 'escalate') {
        const { record, outcome } = realtimeIncidents.escalate(incidentId, who);
        if (outcome === 'escalated') {
          console.warn(formatIncidentLogLine('escalated', record));
          const delivery = await notifyIncident('incident_escalated', record);
          return NextResponse.json({ incident: present(record), delivery }, { headers: { 'Cache-Control': 'no-store' } });
        }
        // Already escalated: report the record, notify nothing, send nothing twice.
        return NextResponse.json({ incident: present(record), delivery: 'already_escalated' }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const record = action === 'acknowledge'
        ? realtimeIncidents.acknowledge(incidentId, who)
        : realtimeIncidents.resolve(incidentId, who);
      const event = action === 'acknowledge' ? 'acknowledged' : 'resolved';
      console.info(formatIncidentLogLine(event, record));
      const delivery = await notifyIncident(action === 'acknowledge' ? 'incident_acknowledged' : 'incident_resolved', record);
      return NextResponse.json({ incident: present(record), delivery }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof IncidentTransitionError) {
        // Unknown id (possibly opened on another instance) or an illegal
        // transition. One generic sentence: the state is the caller's to
        // read from the log, not something this route reveals.
        return NextResponse.json({ error: 'The incident could not be updated.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      }
      throw error;
    }
  } catch {
    return NextResponse.json({ error: 'Monitoring is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
