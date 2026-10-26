/**
 * Same-origin kitchen speaker election using the browser's exclusive Web Lock.
 * It coordinates tabs/windows for this restaurant in this browser profile. It
 * is deliberately not presented as a cross-device or network-wide guarantee.
 */
export type KitchenSpeakerState = 'claiming' | 'leader' | 'busy' | 'local-only' | 'inactive';

type LockManagerLike = {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T> | T,
  ): Promise<T>;
};

const RETRY_MS = 2_000;

export function claimKitchenSpeaker(
  locks: LockManagerLike | null,
  restaurantId: string,
  onState: (state: KitchenSpeakerState) => void,
): () => void {
  let disposed = false;
  let releaseHold: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const hold = new Promise<void>((resolve) => { releaseHold = resolve; });

  if (!locks) {
    onState('local-only');
    return () => onState('inactive');
  }

  const attempt = () => {
    if (disposed) return;
    void locks.request(`autodine:kitchen:speaker:${restaurantId}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (disposed) return;
      if (!lock) {
        onState('busy');
        retry = setTimeout(attempt, RETRY_MS);
        return;
      }
      retry = null;
      onState('leader');
      await hold;
    }).catch(() => {
      if (!disposed) onState('local-only');
    });
  };

  onState('claiming');
  attempt();

  return () => {
    disposed = true;
    if (retry) clearTimeout(retry);
    releaseHold?.();
    onState('inactive');
  };
}
