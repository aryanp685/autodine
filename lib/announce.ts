/**
 * Speaking orders out loud, one at a time.
 *
 * WHY A QUEUE AND NOT JUST speak()
 *
 * The obvious implementation is window.speechSynthesis.speak(), and the
 * obvious way to stop two announcements overlapping is to cancel() before
 * each one. That is what this replaced, and it breaks in the exact case that
 * matters: four tables order within a second of each other, three
 * announcements are cancelled mid-word, and the kitchen hears a fragment of
 * the last one. Guests get their food, so it fails quietly and looks fine.
 *
 * So announcements are queued. Each waits for the one before it to finish.
 * Nothing is cancelled, nothing is dropped, and a burst of orders produces a
 * burst of complete sentences in the order they arrived.
 *
 * WHY THE KEY
 *
 * The kitchen board re-reads itself every few seconds, and every re-read
 * looks like every order again. Without a memory of what was already said,
 * the same ticket would be announced on every single poll -- a board that
 * will not stop talking, which any real kitchen would switch off within a
 * minute and then never turn back on.
 *
 * The key is the order id plus the state being announced, so an order is
 * announced once when it arrives and once per state change after that, and
 * never merely because the clock ticked.
 */

/** How the queue talks. Injected so the queue can be tested without a browser. */
export type Speaker = {
  /** Called for one announcement. Must call onEnd exactly once, even on error. */
  speak(text: string, onEnd: () => void): void;
};

export type AnnounceQueue = {
  /**
   * Queue an announcement.
   *
   * Returns false when the key has already been announced, so the caller can
   * tell "queued" from "already said" without tracking it separately.
   */
  push(key: string, text: string): boolean;
  /** Whether this key was announced before. Does not queue anything. */
  has(key: string): boolean;
  /** Forget a key, so the same announcement can be made again on request. */
  forget(key: string): void;
  /** Announcements waiting, not including the one speaking now. */
  pending(): number;
  /** Whether something is being spoken right now. */
  speaking(): boolean;
};

export function createAnnounceQueue(speaker: Speaker): AnnounceQueue {
  const waiting: { key: string; text: string }[] = [];
  const said = new Set<string>();
  let busy = false;

  function drain(): void {
    if (busy) return;

    const next = waiting.shift();
    if (!next) return;

    busy = true;
    said.add(next.key);

    const finish = () => {
      busy = false;
      drain();
    };

    try {
      speaker.speak(next.text, finish);
    } catch {
      // A speaker that throws must not wedge the queue: without this the
      // board would announce once and then fall silent for the rest of the
      // service, which is indistinguishable from being switched off.
      finish();
    }
  }

  return {
    push(key, text) {
      if (said.has(key)) return false;
      // Also skip a duplicate still waiting, so a double poll does not queue
      // the same thing twice before the first one has been spoken.
      if (waiting.some((entry) => entry.key === key)) return false;

      waiting.push({ key, text });
      drain();
      return true;
    },
    has: (key) => said.has(key),
    forget: (key) => said.delete(key),
    pending: () => waiting.length,
    speaking: () => busy,
  };
}

/**
 * What the pass says when an order arrives.
 *
 * Table first, because that is the half the kitchen acts on -- who to walk
 * the food to. The dishes come second, because that is what the cooks need.
 *
 * Deliberately not the order code. A code is a reference for finding a bill
 * later; nobody carrying a plate needs to hear "MA-K3F9Q", and a kitchen
 * asked to remember one will get it wrong under pressure.
 */
export function newOrderText(
  table: string,
  items: { qty: number; name: string }[]
): string {
  if (items.length === 0) return `New order for ${table}.`;

  const dishes = items.map((i) => `${i.qty} ${i.name}`).join(', ');
  return `New order for ${table}. ${dishes}.`;
}

/** What the pass says when a ticket moves on. */
export function advanceText(table: string, next: string): string {
  return `${table}, ${next}.`;
}

/**
 * Cap on how many dishes are read out.
 *
 * A twelve-item order read in full takes long enough that two more orders
 * land while it is being spoken, and the kitchen stops listening somewhere
 * around the fourth dish. Shortening it is a real loss of information, so the
 * remainder is counted rather than dropped.
 */
export const MAX_SPOKEN_ITEMS = 4;

export function summariseItems(
  items: { qty: number; name: string }[]
): { qty: number; name: string }[] {
  if (items.length <= MAX_SPOKEN_ITEMS) return items;

  const head = items.slice(0, MAX_SPOKEN_ITEMS);
  const rest = items.slice(MAX_SPOKEN_ITEMS);
  const extraQty = rest.reduce((sum, i) => sum + i.qty, 0);

  return [...head, { qty: extraQty, name: `more item${rest.length === 1 ? '' : 's'}` }];
}
