import { describe, expect, it, vi } from 'vitest';
import {
  deliverWithRetry,
  formatHealthAlertLine,
  formatIncidentLogLine,
  InMemoryIncidentTracker,
  IncidentTransitionError,
  validateIncidentSignal,
} from './monitoring-incidents';

const NOW = 1_800_000_000_000;
const signal = (over: Partial<Parameters<typeof validateIncidentSignal>[0] & object> = {}) => ({
  key: 'kitchen-realtime:tenant-a',
  kind: 'kitchen_realtime_degraded' as const,
  severity: 'warning' as const,
  summary: 'Kitchen realtime delivery degraded',
  ...over,
});

describe('validateIncidentSignal', () => {
  it('accepts a well-formed signal and rejects junk', () => {
    expect(validateIncidentSignal(signal())).toEqual(signal());
    expect(validateIncidentSignal(null)).toBeNull();
    expect(validateIncidentSignal({ ...signal(), key: '' })).toBeNull();
    expect(validateIncidentSignal({ ...signal(), key: 'x'.repeat(201) })).toBeNull();
    expect(validateIncidentSignal({ ...signal(), kind: 'Kitchen Degraded' })).toBeNull();
    expect(validateIncidentSignal({ ...signal(), kind: 'ab' })).toBeNull();
    expect(validateIncidentSignal({ ...signal(), severity: 'alert' })).toBeNull();
    expect(validateIncidentSignal({ ...signal(), summary: '   ' })).toBeNull();
  });

  it('strips control characters so one log line stays one line', () => {
    const parsed = validateIncidentSignal(signal({ summary: 'line1\nline2\r\n\x00end' }));
    expect(parsed?.summary).toBe('line1 line2 end');
  });
});

describe('InMemoryIncidentTracker', () => {
  const tracker = () => new InMemoryIncidentTracker({ now: () => NOW, makeId: (() => { let n = 0; return () => `inc-${++n}`; })() });

  it('opens an incident, deduplicates repeats, and keeps severity at the worst seen', () => {
    const t = tracker();
    const first = t.report(signal());
    expect(first.outcome).toBe('opened');
    const second = t.report(signal({ severity: 'info' }));
    expect(second.outcome).toBe('repeated');
    expect(second.record.count).toBe(2);
    expect(second.record.severity).toBe('warning'); // worse severity never downgrades
    const third = t.report(signal({ severity: 'critical' }));
    expect(third.record.severity).toBe('critical'); // escalation wins
  });

  it('a resolved key reports as reopened and gets a new incident id', () => {
    const t = tracker();
    const opened = t.report(signal());
    t.resolve(opened.record.incidentId, 'ops@example');
    const again = t.report(signal());
    expect(again.outcome).toBe('reopened');
    expect(again.record.incidentId).not.toBe(opened.record.incidentId);
  });

  it('acknowledge moves open -> acknowledged and is terminal for acknowledge', () => {
    const t = tracker();
    const { record } = t.report(signal());
    const ack = t.acknowledge(record.incidentId, 'oncall@example');
    expect(ack.state).toBe('acknowledged');
    expect(ack.acknowledgedBy).toBe('oncall@example');
    expect(() => t.acknowledge(record.incidentId, 'other@example')).toThrow(IncidentTransitionError);
  });

  it('resolve is terminal and acknowledge-then-resolve works', () => {
    const t = tracker();
    const { record } = t.report(signal());
    t.acknowledge(record.incidentId, 'oncall@example');
    const resolved = t.resolve(record.incidentId, 'oncall@example');
    expect(resolved.state).toBe('resolved');
    expect(resolved.resolvedBy).toBe('oncall@example');
    expect(() => t.resolve(record.incidentId, 'oncall@example')).toThrow(IncidentTransitionError);
  });

  it('refuses unknown incidents and blank actors', () => {
    const t = tracker();
    expect(() => t.acknowledge('nope', 'a')).toThrow(IncidentTransitionError);
    expect(() => t.resolve('nope', 'a')).toThrow(IncidentTransitionError);
    const { record } = t.report(signal());
    expect(() => t.acknowledge(record.incidentId, '   ')).toThrow(IncidentTransitionError);
  });

  it('sweeps resolved incidents past the ttl', () => {
    let now = NOW;
    const t = new InMemoryIncidentTracker({ now: () => now, ttlMs: 1000, makeId: () => 'inc-1' });
    const { record } = t.report(signal());
    t.resolve(record.incidentId, 'a');
    now += 2000;
    expect(t.sweep()).toBe(1);
    expect(t.get(record.incidentId)).toBeNull();
  });

  it('lists incidents filtered by state', () => {
    const t = tracker();
    const { record } = t.report(signal());
    t.report(signal({ key: 'other:tenant-b' }));
    expect(t.list('open')).toHaveLength(2);
    t.resolve(record.incidentId, 'a');
    expect(t.list('open')).toHaveLength(1);
    expect(t.list('resolved')).toHaveLength(1);
  });
});

describe('formatIncidentLogLine', () => {
  it('emits a stable single-line JSON entry and never any key material', () => {
    const t = new InMemoryIncidentTracker({ now: () => NOW, makeId: () => 'inc-1' });
    const { record, outcome } = t.report(signal());
    const line = formatIncidentLogLine(outcome, record);
    expect(line.startsWith('[autodine:alert] ')).toBe(true);
    const parsed = JSON.parse(line.slice('[autodine:alert] '.length));
    expect(parsed).toMatchObject({ event: 'incident_opened', incidentId: 'inc-1', kind: 'kitchen_realtime_degraded', severity: 'warning', state: 'open', count: 1 });
    expect(line).not.toContain('tenant-a'); // dedup key never logged
    expect(line.includes('\n')).toBe(false);
  });
});

describe('formatHealthAlertLine', () => {
  it('emits fixed-vocabulary booleans only, coercing anything unexpected', () => {
    const line = formatHealthAlertLine({
      configured: true, serverKey: true, reachable: false,
      credentials: 'rejected', credentialProbe: 'PGRST301',
      schema: { trialAndWriteGate: 'applied', planEntitlements: 'missing', upi: 'whatever', junk: '1234' },
    });
    const parsed = JSON.parse(line.slice('[autodine:alert] '.length));
    expect(parsed).toMatchObject({ event: 'health_check_failed', severity: 'critical', configured: true, reachable: false, credentials: 'rejected', credentialProbe: 'PGRST301' });
    expect(parsed.schema.upi).toBe('unknown');
    expect(parsed.schema.junk).toBe('unknown');
  });

  it('does not forward attacker-shaped probe text', () => {
    const line = formatHealthAlertLine({ configured: true, serverKey: true, reachable: true, credentials: 'rejected\nFORGED', credentialProbe: 'DROP TABLE', schema: { x: 'applied' } });
    const parsed = JSON.parse(line.slice('[autodine:alert] '.length));
    expect(parsed.credentials).toBe('unknown');
    expect(parsed.credentialProbe).toBeNull();
  });
});

describe('deliverWithRetry', () => {
  it('delivers on first success with no delay', async () => {
    const sleep = vi.fn(async () => {});
    const result = await deliverWithRetry(async () => {}, { sleep });
    expect(result).toEqual({ delivered: true, attempts: 1 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('backs off exponentially and gives up after maxAttempts without throwing', async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    let calls = 0;
    const result = await deliverWithRetry(async () => { calls += 1; throw new Error('provider down'); }, { maxAttempts: 3, baseDelayMs: 100, sleep });
    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200]);
    expect(result).toEqual({ delivered: false, attempts: 3 });
  });

  it('recovers on a later attempt', async () => {
    let calls = 0;
    const result = await deliverWithRetry(async () => { calls += 1; if (calls < 3) throw new Error('flaky'); }, { maxAttempts: 5, baseDelayMs: 0, sleep: async () => {} });
    expect(result).toEqual({ delivered: true, attempts: 3 });
  });
});

describe('getByKey / resolveByKey', () => {
  it('resolves the live incident for a key and is idempotent afterwards', () => {
    const t = new InMemoryIncidentTracker({ now: () => NOW, makeId: () => 'inc-x' });
    t.report(signal());
    expect(t.getByKey('kitchen-realtime:tenant-a')?.incidentId).toBe('inc-x');
    const resolved = t.resolveByKey('kitchen-realtime:tenant-a', 'kitchen');
    expect(resolved?.state).toBe('resolved');
    expect(t.resolveByKey('kitchen-realtime:tenant-a', 'kitchen')).toBeNull();
    expect(t.getByKey('kitchen-realtime:tenant-a')).toBeNull();
  });
});
