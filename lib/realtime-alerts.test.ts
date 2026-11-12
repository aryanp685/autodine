import { describe, expect, it } from 'vitest';
import { parseRealtimeSignal, realtimeAlertRateKey } from './realtime-alerts';

describe('Realtime operational signals', () => {
  it('accepts a sustained degradation and a recovery duration', () => {
    expect(parseRealtimeSignal({ kind: 'degraded', durationMs: 60_000 })).toEqual({ kind: 'degraded', durationMs: 60_000 });
    expect(parseRealtimeSignal({ kind: 'recovered', durationMs: 60_000 })).toEqual({ kind: 'recovered', durationMs: 60_000 });
  });

  it.each([
    null,
    [],
    { kind: 'degraded', durationMs: 59_999 },
    { kind: 'degraded', durationMs: 60_000.5 },
    { kind: 'degraded', durationMs: 3_600_001 },
    { kind: 'recovered', durationMs: -1 },
    { kind: 'degraded', durationMs: 60_000, restaurantName: 'not accepted' },
    { kind: 'unknown', durationMs: 60_000 },
  ])('rejects malformed or over-broad input %#', (value) => {
    expect(parseRealtimeSignal(value)).toBeNull();
  });

  it('scopes throttling to the authenticated restaurant without exposing identity in the signal', () => {
    expect(realtimeAlertRateKey('tenant-123')).toBe('realtime-alert:tenant-123');
  });
});
