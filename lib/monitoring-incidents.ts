/**
 * Provider-independent incident management.
 *
 * WHAT THIS IS
 *
 * A small, dependency-free core that turns application failure signals into
 * structured, deduplicated incident records, with acknowledge/resolve
 * transitions, log-line formatting and retry-wrapped delivery. Any provider
 * (a log drain, an uptime service, a webhook, a future pager) can consume
 * the same JSON lines — nothing here assumes one exists, and nothing here
 * claims an alert was delivered anywhere.
 *
 * WHAT IT MUST NEVER DO
 *
 * - Carry tenant, user, order, payment or credential material. Callers pass
 *   a stable, opaque `key` for deduplication only; the key is held in memory
 *   and is never written to logs. Summaries are trimmed, length-capped and
 *   stripped of control characters, and formatters only ever emit fixed
 *   fields.
 * - Pretend delivery happened. `deliverWithRetry` reports attempts and a
 *   boolean; success is the caller's responsibility to observe.
 * - Replace the database. The in-memory tracker is per server instance;
 *   structured log lines remain the durable record.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type IncidentState = 'open' | 'acknowledged' | 'resolved';

export type IncidentSignal = {
  /** Opaque dedup key, in memory only; never logged. ≤ 200 chars. */
  key: string;
  /** Fixed vocabulary, e.g. `kitchen_realtime_degraded`. Lowercase snake_case. */
  kind: string;
  severity: AlertSeverity;
  /** One line, tenant-free. Capped at 200 chars, control chars removed. */
  summary: string;
};

export type IncidentRecord = {
  incidentId: string;
  kind: string;
  severity: AlertSeverity;
  summary: string;
  state: IncidentState;
  /** How many times this signal fired while the incident was live/tracked. */
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  /** Set when an owner/manager (or the cron) escalated an unacknowledged incident. */
  escalatedAt: number | null;
  escalatedBy: string | null;
};

export type ReportOutcome = 'opened' | 'repeated' | 'reopened';

export class IncidentTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncidentTransitionError';
  }
}

const KIND_RE = /^[a-z][a-z0-9_]{2,63}$/;
const MAX_KEY = 200;
const MAX_SUMMARY = 200;
const MAX_ACTOR = 80;
const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };

const stripControl = (value: string) => value.replace(/[\x00-\x1f\x7f]+/g, ' ');
const cleanSummary = (value: unknown): string =>
  stripControl(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY);
const cleanActor = (value: unknown): string =>
  stripControl(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, MAX_ACTOR);

const isSeverity = (value: unknown): value is AlertSeverity =>
  value === 'info' || value === 'warning' || value === 'critical';

export function validateIncidentSignal(value: unknown): IncidentSignal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const key = typeof body.key === 'string' ? stripControl(body.key).trim() : '';
  const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
  const summary = cleanSummary(body.summary);
  if (!key || key.length > MAX_KEY) return null;
  if (!KIND_RE.test(kind)) return null;
  if (!isSeverity(body.severity)) return null;
  if (!summary) return null;
  return { key, kind, severity: body.severity, summary };
}

export class InMemoryIncidentTracker {
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly ttlMs: number;
  private readonly makeId: () => string;
  private readonly incidents = new Map<string, IncidentRecord>();
  private readonly liveByKey = new Map<string, string>();
  private readonly lastResolvedByKey = new Map<string, number>();

  constructor(options: {
    now?: () => number;
    /** Suppress duplicates for a live incident; default 10 minutes. */
    cooldownMs?: number;
    /** Keep resolved incidents this long for reopen detection; default 24h. */
    ttlMs?: number;
    makeId?: () => string;
  } = {}) {
    // Resolved at call time (not construction time) so a frozen Date.now
    // in tests is honoured by the shared registry.
    this.now = options.now ?? (() => Date.now());
    this.cooldownMs = options.cooldownMs ?? 10 * 60 * 1000;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.makeId = options.makeId ?? (() => globalThis.crypto?.randomUUID?.() ?? `incident-${this.now()}`);
  }

  report(signal: IncidentSignal): { record: IncidentRecord; outcome: ReportOutcome } {
    const checked = validateIncidentSignal(signal);
    if (!checked) throw new TypeError('Invalid incident signal.');
    const now = this.now();
    this.sweep();
    const liveId = this.liveByKey.get(checked.key);
    if (liveId) {
      const live = this.incidents.get(liveId);
      if (live && live.state !== 'resolved') {
        live.count += 1;
        live.lastSeenAt = now;
        if (SEVERITY_RANK[checked.severity] > SEVERITY_RANK[live.severity]) live.severity = checked.severity;
        live.summary = checked.summary; // newest context wins; still tenant-free
        return { record: { ...live }, outcome: 'repeated' };
      }
      this.liveByKey.delete(checked.key);
    }
    const lastResolved = this.lastResolvedByKey.get(checked.key);
    const record: IncidentRecord = {
      incidentId: this.makeId(),
      kind: checked.kind,
      severity: checked.severity,
      summary: checked.summary,
      state: 'open',
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedBy: null,
      resolvedAt: null,
      escalatedAt: null,
      escalatedBy: null,
    };
    this.incidents.set(record.incidentId, record);
    this.liveByKey.set(checked.key, record.incidentId);
    const outcome: ReportOutcome = lastResolved !== undefined && now - lastResolved <= this.ttlMs ? 'reopened' : 'opened';
    return { record: { ...record }, outcome };
  }

  acknowledge(incidentId: string, actor: string): IncidentRecord {
    const incident = this.require(incidentId);
    const who = cleanActor(actor);
    if (!who) throw new IncidentTransitionError('An acknowledging actor is required.');
    if (incident.state !== 'open') {
      throw new IncidentTransitionError(`Cannot acknowledge an incident in state '${incident.state}'.`);
    }
    incident.state = 'acknowledged';
    incident.acknowledgedBy = who;
    incident.acknowledgedAt = this.now();
    return { ...incident };
  }

  resolve(incidentId: string, actor: string): IncidentRecord {
    const incident = this.require(incidentId);
    const who = cleanActor(actor);
    if (!who) throw new IncidentTransitionError('Resolving actor is required.');
    if (incident.state === 'resolved') {
      throw new IncidentTransitionError('This incident is already resolved.');
    }
    incident.state = 'resolved';
    incident.resolvedBy = who;
    incident.resolvedAt = this.now();
    for (const [key, id] of this.liveByKey) {
      if (id === incident.incidentId) {
        this.liveByKey.delete(key);
        this.lastResolvedByKey.set(key, incident.resolvedAt);
        break;
      }
    }
    return { ...incident };
  }

  get(incidentId: string): IncidentRecord | null {
    const incident = this.incidents.get(incidentId);
    return incident ? { ...incident } : null;
  }

  /**
   * Bump an open incident to critical and mark it escalated. Escalation is NOT
   * a state transition -- the incident is still open and still needs a person.
   * Idempotent: an already-escalated incident reports `already_escalated` and
   * changes nothing, so a cron re-run never spams.
   */
  escalate(incidentId: string, actor: string): { record: IncidentRecord; outcome: 'escalated' | 'already_escalated' } {
    const incident = this.require(incidentId);
    const who = cleanActor(actor);
    if (!who) throw new IncidentTransitionError('An escalating actor is required.');
    if (incident.state === 'resolved') {
      throw new IncidentTransitionError(`Cannot escalate an incident in state '${incident.state}'.`);
    }
    if (incident.escalatedAt !== null) {
      return { record: { ...incident }, outcome: 'already_escalated' };
    }
    incident.severity = 'critical';
    incident.escalatedAt = this.now();
    incident.escalatedBy = who;
    return { record: { ...incident }, outcome: 'escalated' };
  }

  /**
   * Open, not-yet-escalated incidents whose `firstSeenAt` is older than
   * `olderThanMs` — the cron's candidate list. Pure read; nothing is mutated.
   */
  staleOpen(olderThanMs: number): IncidentRecord[] {
    const now = this.now();
    return [...this.incidents.values()]
      .filter((incident) => incident.state === 'open' && incident.escalatedAt === null && now - incident.firstSeenAt >= olderThanMs)
      .map((incident) => ({ ...incident }));
  }

  /** The live (non-resolved) incident for a key, if any. */
  getByKey(key: string): IncidentRecord | null {
    const id = this.liveByKey.get(stripControl(String(key ?? '')).trim().slice(0, MAX_KEY));
    if (!id) return null;
    return this.get(id);
  }

  /** Resolve the live incident for a key, if any. */
  resolveByKey(key: string, actor: string): IncidentRecord | null {
    const live = this.getByKey(key);
    if (!live) return null;
    return this.resolve(live.incidentId, actor);
  }

  list(state?: IncidentState): IncidentRecord[] {
    return [...this.incidents.values()]
      .filter((incident) => (state ? incident.state === state : true))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((incident) => ({ ...incident }));
  }

  /** Drop resolved incidents past the TTL; returns how many were dropped. */
  sweep(): number {
    const now = this.now();
    let dropped = 0;
    for (const [id, incident] of this.incidents) {
      if (incident.state === 'resolved' && incident.resolvedAt !== null && now - incident.resolvedAt > this.ttlMs) {
        this.incidents.delete(id);
        dropped += 1;
      }
    }
    for (const [key, at] of this.lastResolvedByKey) {
      if (now - at > this.ttlMs) this.lastResolvedByKey.delete(key);
    }
    return dropped;
  }

  private require(incidentId: string): IncidentRecord {
    const incident = this.incidents.get(incidentId);
    if (!incident) throw new IncidentTransitionError('Incident not found.');
    return incident;
  }
}

/** Fixed-shape JSON line for log drains and alert rules. Prefix is stable. */
export function formatIncidentLogLine(outcome: ReportOutcome | 'acknowledged' | 'resolved' | 'escalated' | 'already_escalated', record: IncidentRecord): string {
  const event = outcome === 'opened' || outcome === 'reopened' || outcome === 'repeated'
    ? `incident_${outcome}`
    : `incident_${outcome}`;
  return `[autodine:alert] ${JSON.stringify({
    event,
    incidentId: record.incidentId,
    kind: record.kind,
    severity: record.severity,
    state: record.state,
    count: record.count,
    summary: record.summary,
    ...(record.escalatedAt ? { escalatedAt: record.escalatedAt, escalatedBy: record.escalatedBy } : {}),
  })}`;
}

/**
 * Fixed-shape line for /api/health when the deployment is not ready. booleans
 * and fixed vocabulary only; the caller decides severity by HTTP status.
 */
export function formatHealthAlertLine(input: {
  configured: boolean;
  serverKey: boolean;
  reachable: boolean;
  credentials: string;
  credentialProbe: string | null;
  schema: Record<string, string>;
}): string {
  const pickProbe = (value: unknown): string =>
    value === 'applied' || value === 'missing' || value === 'unreachable' || value === 'unauthorized' ? value : 'unknown';
  const credentials = input.credentials === 'accepted' || input.credentials === 'rejected' ? input.credentials : 'unknown';
  const schema: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.schema ?? {})) {
    schema[stripControl(key).slice(0, 40)] = pickProbe(value);
  }
  return `[autodine:alert] ${JSON.stringify({
    event: 'health_check_failed',
    severity: 'critical',
    configured: Boolean(input.configured),
    serverKey: Boolean(input.serverKey),
    reachable: Boolean(input.reachable),
    credentials,
    credentialProbe: input.credentialProbe && /^[A-Z0-9]{5}$|^PGRST\d{3}$/.test(input.credentialProbe) ? input.credentialProbe : null,
    schema,
  })}`;
}

export type DeliverWithRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};
export type DeliverWithRetryResult = { delivered: boolean; attempts: number };

/**
 * Best-effort delivery with bounded exponential backoff. Never throws. The
 * result reports what actually happened; callers must not infer delivery.
 */
export async function deliverWithRetry(
  deliver: () => Promise<void>,
  options: DeliverWithRetryOptions = {}
): Promise<DeliverWithRetryResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 250));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      await deliver();
      return { delivered: true, attempts };
    } catch {
      if (attempt < maxAttempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  return { delivered: false, attempts };
}
