export type RealtimeSignal =
  | { kind: 'degraded'; durationMs: number }
  | { kind: 'recovered'; durationMs: number };

const MIN_DEGRADED_MS = 60_000;
const MAX_DURATION_MS = 60 * 60 * 1000;

/** Accept only small, fixed-shape operational signals; never accept tenant or user text. */
export function parseRealtimeSignal(value: unknown): RealtimeSignal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'kind' && key !== 'durationMs')) return null;
  if (body.kind !== 'degraded' && body.kind !== 'recovered') return null;
  if (!Number.isSafeInteger(body.durationMs)) return null;
  const durationMs = body.durationMs as number;
  if (durationMs < 0 || durationMs > MAX_DURATION_MS) return null;
  if (body.kind === 'degraded' && durationMs < MIN_DEGRADED_MS) return null;
  return { kind: body.kind, durationMs };
}

/** One shared service-side alert budget per restaurant, independent of browser tabs. */
export function realtimeAlertRateKey(restaurantId: string): string {
  return `realtime-alert:${restaurantId}`;
}
