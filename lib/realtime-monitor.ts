export type RealtimeDelivery = 'connecting' | 'live' | 'polling';
export type RealtimeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | string;
export type RealtimeAlertSignal = { kind: 'degraded' | 'recovered'; durationMs: number };

/** Track sustained channel outages; polling remains active while the alert timer runs. */
export function createRealtimeMonitor(options: {
  onDelivery: (delivery: RealtimeDelivery) => void;
  onSignal: (signal: RealtimeAlertSignal) => void;
  thresholdMs?: number;
  now?: () => number;
}) {
  const thresholdMs = options.thresholdMs ?? 60_000;
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let degradedAt: number | null = null;
  let alertSent = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    onStatus(status: RealtimeStatus) {
      if (status === 'SUBSCRIBED') {
        options.onDelivery('live');
        clear();
        if (degradedAt !== null && alertSent) {
          options.onSignal({ kind: 'recovered', durationMs: Math.max(0, Math.round(now() - degradedAt)) });
        }
        degradedAt = null;
        alertSent = false;
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        options.onDelivery('polling');
        if (degradedAt === null) {
          degradedAt = now();
          timer = setTimeout(() => {
            if (degradedAt === null) return;
            alertSent = true;
            options.onSignal({ kind: 'degraded', durationMs: Math.max(0, Math.round(now() - degradedAt)) });
          }, thresholdMs);
        }
        return;
      }
      options.onDelivery('connecting');
    },
    dispose() {
      clear();
      degradedAt = null;
      alertSent = false;
    },
  };
}
