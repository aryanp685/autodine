export type MissedOrderStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const missedOrderStorageKey = (restaurantId: string | null) =>
  `autodine:kitchen:missed:${restaurantId ?? 'demo'}`;

/** Best-effort browser-local recovery IDs, scoped to the current restaurant. */
export function readMissedOrderIds(storage: MissedOrderStorage | null, restaurantId: string | null): string[] {
  try {
    if (!storage) return [];
    const raw = storage.getItem(missedOrderStorageKey(restaurantId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))].slice(-100)
      : [];
  } catch {
    return [];
  }
}

export function writeMissedOrderIds(
  storage: MissedOrderStorage | null,
  restaurantId: string | null,
  ids: string[],
): void {
  try {
    if (!storage) return;
    storage.setItem(missedOrderStorageKey(restaurantId), JSON.stringify([...new Set(ids)].slice(-100)));
  } catch {
    // Private browsing/quota failures are non-fatal; current-session state remains.
  }
}
