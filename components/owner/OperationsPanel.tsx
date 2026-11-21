'use client';

/**
 * Settings → Operations: this instance's live incidents, acknowledge and resolve.
 *
 * WHAT AN INCIDENT IS HERE
 *
 * Fixed vocabulary only — kind, severity, state, count, summary. Incidents are
 * opened by the app's own guards (kitchen realtime channel, health probe) on
 * the server instance that saw the failure. There is no tenant data in them,
 * and the durable record is the structured log line; this panel is a window,
 * not the archive. An incident opened on another instance will not appear here
 * — it is still in the logs and in whatever drains them.
 *
 * The panel never claims delivery. The `delivery` field the API returns says
 * what happened to the alert webhook, and it is shown verbatim.
 */

import { useCallback, useEffect, useState } from 'react';
import { Notice, Panel, Tag } from '@/components/owner/chrome';

type Incident = {
  incidentId: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  state: 'open' | 'acknowledged' | 'resolved';
  count: number;
  summary: string;
  firstSeenAt: number;
  lastSeenAt: number;
  acknowledgedBy: string | null;
  escalatedAt: number | null;
};

type ChannelCounters = {
  delivered: number;
  failed: number;
  notConfigured: number;
  refused: number;
  attempts: number;
  consecutiveFailures: number;
  lastOutcome: string | null;
  lastAt: number | null;
};

type Telemetry = { email: ChannelCounters; alert: ChannelCounters };

const SEVERITY_TONE = { info: 'neutral', warning: 'work', critical: 'due' } as const;
const STATE_TONE = { open: 'due', acknowledged: 'work', resolved: 'neutral' } as const;

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> | null }> {
  try {
    const response = await fetch('/api/ops/incidents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, payload };
  } catch {
    return { ok: false, status: 0, payload: null };
  }
}

function age(since: number, now: number): string {
  const ms = Math.max(0, now - since);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

function TwoStepButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setArmed(true)}
        className="inline-flex h-9 items-center rounded-[var(--p-r-control)] border border-hair px-3.5 text-[12.5px] font-medium text-gink transition-colors hover:bg-[var(--p-surface-2)] disabled:opacity-50"
      >
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span role="status" className="text-[11.5px] font-medium text-gink">Confirm?</span>
      <button
        type="button"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        className="inline-flex h-9 items-center rounded-[var(--p-r-control)] bg-gink px-3.5 text-[12.5px] font-semibold text-[var(--p-surface)] disabled:opacity-50"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="inline-flex h-9 items-center rounded-[var(--p-r-control)] border border-hair px-3 text-[12.5px] font-medium text-gink-64"
      >
        No
      </button>
    </span>
  );
}

export function OperationsPanel({ disabled = false }: { disabled?: boolean }) {
  const [incidents, setIncidents] = useState<Incident[] | null>(disabled ? [] : null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(disabled);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { ok, status, payload } = await post({ action: 'list' });
    if (!ok) {
      // 503 is the route saying monitoring is not configured here (demo,
      // preview or no Supabase) -- a fact, not a failure of this panel.
      if (status === 503) {
        setUnavailable(true);
        setIncidents([]);
        setError(null);
        setNow(Date.now());
        return;
      }
      setError(
        payload && typeof payload.error === 'string'
          ? payload.error
          : 'The incident list could not be loaded.',
      );
      setIncidents((current) => current ?? []);
      return;
    }
    const list = Array.isArray(payload?.incidents) ? (payload.incidents as Incident[]) : [];
    setIncidents(list.filter((incident) => incident.state !== 'resolved'));
    const rawTelemetry = payload?.telemetry as Telemetry | undefined;
    if (rawTelemetry && rawTelemetry.email && rawTelemetry.alert) {
      setTelemetry(rawTelemetry);
    }
    setUnavailable(false);
    setError(null);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    // Disabled means the page already knows there is no database behind this
    // instance; a request would only produce a 503 in the console.
    if (disabled) return;
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [load, disabled]);

  const act = useCallback(
    async (action: 'acknowledge' | 'resolve' | 'escalate', incidentId: string) => {
      setBusy(`${action}:${incidentId}`);
      setDelivery(null);
      const { ok, payload } = await post({ action, incidentId });
      if (!ok) {
        setError(
          payload && typeof payload.error === 'string'
            ? payload.error
            : 'The incident could not be updated.',
        );
      } else {
        setError(null);
        const delivered = payload?.delivery;
        if (typeof delivered === 'string') setDelivery(delivered);
        else if (delivered && typeof delivered === 'object' && 'outcome' in delivered) {
          setDelivery(String((delivered as { outcome: unknown }).outcome));
        }
      }
      setBusy(null);
      await load();
    },
    [load],
  );

  const live = incidents ?? [];

  return (
    <Panel
      title="Operations"
      meta={
        incidents === null
          ? 'Loading…'
          : unavailable
            ? 'Not available here'
            : `${live.length} open on this instance`
      }
      bodyClassName="px-5 py-4"
    >
      {error ? <Notice tone="due" label="Something did not work.">{error}</Notice> : null}
      {delivery ? (
        <p className="mt-2 text-[11.5px] text-gink-46">
          Alert webhook: <strong className="font-semibold text-gink">{delivery}</strong>
        </p>
      ) : null}

      {telemetry ? (
        <div className="mt-2 border-t border-[var(--p-line-soft)] pt-2">
          <p className="text-[11.5px] leading-[1.6] text-gink-46">
            Delivery telemetry (this instance): alerts {telemetry.alert.delivered} delivered ·{' '}
            {telemetry.alert.failed} failed · email {telemetry.email.delivered} delivered ·{' '}
            {telemetry.email.failed} failed
            {telemetry.alert.consecutiveFailures > 0 || telemetry.email.consecutiveFailures > 0
              ? ` · ${telemetry.alert.consecutiveFailures + telemetry.email.consecutiveFailures} consecutive failure(s) — check the webhook/provider configuration`
              : ''}
            . Counters reset on restart; the structured log remains the durable record.
          </p>
        </div>
      ) : null}

      {unavailable ? (
        <p className="text-[13px] leading-[1.55] text-gink-64">
          Live incidents are not available in this environment. The structured log remains the
          durable record, and this panel makes no claim either way about current health.
        </p>
      ) : null}

      {incidents !== null && live.length === 0 && !error && !unavailable ? (
        <p className="text-[13px] leading-[1.55] text-gink-64">
          Nothing is open right now. Failures that the app can see — a degraded kitchen channel, a
          failed health probe — appear here with a button to acknowledge or resolve them, and stay
          in the logs either way. Webhook delivery happens only if an alert webhook is configured.
        </p>
      ) : null}

      <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
        {live.map((incident) => (
          <li
            key={incident.incidentId}
            className="rounded-[var(--p-r-control)] border border-hair px-4 py-3"
            data-incident-id={incident.incidentId}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</Tag>
              <Tag tone={STATE_TONE[incident.state]}>{incident.state}</Tag>
              <span className="tnum text-[11.5px] text-gink-46">×{incident.count}</span>
              <span className="tnum ml-auto text-[11.5px] text-gink-46">{age(incident.lastSeenAt, now)}</span>
            </div>
            <p className="mt-2 text-[13px] leading-[1.5] text-gink">{incident.summary}</p>
            <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-gink-46">
              {incident.kind}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {incident.state === 'open' ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act('acknowledge', incident.incidentId)}
                  className="inline-flex h-9 items-center rounded-[var(--p-r-control)] border border-hair px-3.5 text-[12.5px] font-medium text-gink transition-colors hover:bg-[var(--p-surface-2)] disabled:opacity-50"
                >
                  {busy === `acknowledge:${incident.incidentId}` ? 'Acknowledging…' : 'Acknowledge'}
                </button>
              ) : null}
              {incident.state !== 'resolved' ? (
                <>
                  <TwoStepButton
                    label="Resolve"
                    confirmLabel="Resolve"
                    disabled={busy !== null}
                    onConfirm={() => void act('resolve', incident.incidentId)}
                  />
                  {!incident.escalatedAt && incident.state === 'open' ? (
                    <TwoStepButton
                      label="Escalate"
                      confirmLabel="Escalate"
                      disabled={busy !== null}
                      onConfirm={() => void act('escalate', incident.incidentId)}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--p-line-soft)] pt-3">
        <p className="text-[11.5px] leading-[1.5] text-gink-46">
          This instance only; other instances report to the same logs. Nothing here is sent anywhere
          unless an alert webhook is configured.
        </p>
        {disabled ? null : (
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 text-[12.5px] font-medium text-gink-64 underline underline-offset-2 hover:text-gink"
          >
            Refresh
          </button>
        )}
      </div>
    </Panel>
  );
}
