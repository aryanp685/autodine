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

const SEVERITY_TONE = { info: 'neutral', warning: 'work', critical: 'due' } as const;
const STATE_TONE = { open: 'due', acknowledged: 'work', resolved: 'neutral' } as const;

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; payload: Record<string, unknown> | null }> {
  try {
    const response = await fetch('/api/ops/incidents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, payload };
  } catch {
    return { ok: false, payload: null };
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

export function OperationsPanel() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { ok, payload } = await post({ action: 'list' });
    if (!ok) {
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
    setError(null);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

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
      meta={incidents === null ? 'Loading…' : `${live.length} open on this instance`}
      bodyClassName="px-5 py-4"
    >
      {error ? <Notice tone="due" label="Something did not work.">{error}</Notice> : null}
      {delivery ? (
        <p className="mt-2 text-[11.5px] text-gink-46">
          Alert webhook: <strong className="font-semibold text-gink">{delivery}</strong>
        </p>
      ) : null}

      {incidents !== null && live.length === 0 && !error ? (
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
        <p className="text-[11px] leading-[1.5] text-gink-46">
          This instance only; other instances report to the same logs. Nothing here is sent anywhere
          unless an alert webhook is configured.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="shrink-0 text-[12px] font-medium text-gink-64 underline underline-offset-2 hover:text-gink"
        >
          Refresh
        </button>
      </div>
    </Panel>
  );
}
