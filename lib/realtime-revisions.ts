/** Persisted watermarks, not a replayable queue. Versions are per aggregate. */
export function revisionNumber(value: unknown): bigint | null {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  return /^(0|[1-9]\d{0,18})$/.test(text) ? BigInt(text) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const liveIdentifier = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function parseOutletSignal(outletId: string, value: unknown): bigint | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.outlet_id !== outletId || !liveIdentifier(row.event_id) ||
      typeof row.changed_at !== 'string' || !Number.isFinite(Date.parse(row.changed_at))) return null;
  const version = revisionNumber(row.version);
  return version !== null && version > 0n ? version : null;
}

/** Only wake from the wire; never apply an order/payment mutation from a message. */
export function createRevisionCursor(onAdvance: () => void) {
  let highest = -1n;
  return {
    observe(version: bigint | null) {
      if (version === null || version <= highest) return false;
      highest = version;
      onAdvance();
      return true;
    },
  };
}
