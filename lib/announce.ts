/**
 * Speaking orders out loud, one at a time -- and saying the RIGHT thing.
 *
 * WHY A QUEUE AND NOT JUST speak()
 *
 * The obvious implementation is window.speechSynthesis.speak(), and the
 * obvious way to stop two announcements overlapping is to cancel() before
 * each one. That is what this replaced, and it breaks in the exact case that
 * matters: four tables order within a second of each other, three
 * announcements are cancelled mid-word, and the kitchen hears a fragment of
 * the last one. Guests still get their food, so it fails quietly.
 *
 * So announcements are queued. Each waits for the one before it to finish.
 * Nothing is cancelled, nothing is dropped, and a burst of orders produces a
 * burst of complete sentences in the order they arrived.
 *
 * WHY THE KEY
 *
 * The kitchen board re-reads itself every few seconds, and every re-read
 * looks like every order again. Without a memory of what was already said,
 * the same ticket would be announced on every poll -- a board that will not
 * stop talking, which any real kitchen would switch off within a minute and
 * then never turn back on.
 *
 * WHY THE WORDS MATTER
 *
 * A cook does not read the screen; they hear "table four, two butter
 * chicken". If the announcement says "1 Butter Chicken" when the guest
 * ordered a HALF portion, the kitchen plates a full one and the restaurant
 * loses money on every such ticket. So the spoken sentence carries the
 * portion, the add-ons and the guest's note -- the same detail the ticket
 * card shows, because the voice is the only version some cooks get.
 */

/** How the queue talks. Injected so the queue can be tested without a browser. */
export type Speaker = {
  /** Called for one announcement. Must call onEnd exactly once, even on error. */
  speak(text: string, onEnd: () => void): void;
};

/**
 * 'order' is a ticket the kitchen has not seen before: never dropped.
 * 'info' is a state change the board already shows on screen: dropped when
 * the queue is backed up, because six queued tickets are more important than
 * hearing that table two is now preparing.
 */
export type AnnouncePriority = 'order' | 'info';

export type AnnounceQueue = {
  /**
   * Queue an announcement.
   *
   * Returns false when the key has already been announced, when the same text
   * is already waiting, or when an 'info' announcement was dropped because
   * the queue is backed up. In all three cases nothing will be spoken.
   */
  push(key: string, text: string, priority?: AnnouncePriority): boolean;
  /** Whether this key was announced before. Does not queue anything. */
  has(key: string): boolean;
  /** Forget a key, so the same announcement can be made again on request. */
  forget(key: string): void;
  /** Announcements waiting, not including the one speaking now. */
  pending(): number;
  /** Waiting plus the one being spoken. What the UI shows as "2 queued". */
  depth(): number;
  /** Whether something is being spoken right now. */
  speaking(): boolean;
};

/**
 * How many announcements may be waiting before informational ones start being
 * dropped. Four orders in a burst is the case this feature exists for and must
 * never be trimmed; beyond that the queue is describing the past, and a
 * "table two is ready" read out ninety seconds late is noise in a kitchen.
 */
export const MAX_BACKLOG = 6;

export function createAnnounceQueue(speaker: Speaker): AnnounceQueue {
  const waiting: { key: string; text: string; priority: AnnouncePriority }[] = [];
  const said = new Set<string>();
  let busy = false;

  function drain(): void {
    if (busy) return;

    const next = waiting.shift();
    if (!next) return;

    busy = true;
    said.add(next.key);

    const finish = () => {
      // Guard against a speaker that calls onEnd twice (an utterance can fire
      // both onend and onerror on some engines). Without this the queue would
      // run two announcements at once, which is the exact bug it exists for.
      if (!busy) return;
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
    push(key, text, priority = 'order') {
      if (said.has(key)) return false;
      // Also skip a duplicate still waiting, so a double poll does not queue
      // the same thing twice before the first one has been spoken.
      if (waiting.some((entry) => entry.key === key)) return false;
      if (priority === 'info' && waiting.length >= MAX_BACKLOG) return false;

      waiting.push({ key, text, priority });
      drain();
      return true;
    },
    has: (key) => said.has(key),
    forget: (key) => said.delete(key),
    pending: () => waiting.length,
    depth: () => waiting.length + (busy ? 1 : 0),
    speaking: () => busy,
  };
}

/* ========================================================================== */
/*  Words                                                                     */
/* ========================================================================== */

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/**
 * A count as a word.
 *
 * Speech engines read a bare digit as a digit and hang a pause on it: "2.
 * Butter Chicken" comes out stilted and slow. A word flows. Above twenty the
 * digit is clearer than a long phrase, so it is left as digits.
 */
export function numberWord(n: number): string {
  const rounded = Math.round(n);
  if (!Number.isFinite(rounded) || rounded < 0) return String(n);
  return rounded <= 20 ? NUMBER_WORDS[rounded] : String(rounded);
}

/** How long a guest's note may be before it is cut. Spoken, not printed. */
export const MAX_SPOKEN_NOTE = 120;

export type SpeakableItem = {
  qty: number;
  name: string;
  /** "Half", "Full · Butter naan" -- the portion and any add-ons, as shown. */
  detail?: string;
};

/**
 * One dish, as a clause.
 *
 * "two Butter Chicken, Half, Butter naan"
 *
 * The separators in `detail` are the middot the ticket card uses; a voice
 * reads a middot as nothing at all, so it becomes a comma.
 */
export function spokenItem(item: SpeakableItem): string {
  const base = `${numberWord(item.qty)} ${item.name}`;

  const detail = (item.detail ?? '')
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  return detail ? `${base}, ${detail}` : base;
}

/**
 * Cap on how many dishes are read out.
 *
 * A twelve-item order read in full takes long enough that two more orders land
 * while it is being spoken, and the kitchen stops listening somewhere around
 * the fourth dish. Shortening it is a real loss of information, so the
 * remainder is counted rather than dropped -- and it is counted in DISHES as
 * well as in lines, because "and four more items" is what a cook acts on.
 */
export const MAX_SPOKEN_ITEMS = 4;

export function summariseItems<T extends SpeakableItem>(items: T[]): T[] {
  if (items.length <= MAX_SPOKEN_ITEMS) return items;

  const head = items.slice(0, MAX_SPOKEN_ITEMS);
  const rest = items.slice(MAX_SPOKEN_ITEMS);
  const extraQty = rest.reduce((sum, i) => sum + i.qty, 0);

  // Cast because the tail is a plain summary rather than a real dish: it has
  // a quantity and a name and nothing else, which is all the reader needs.
  return [...head, { qty: extraQty, name: `more item${rest.length === 1 ? '' : 's'}` } as unknown as T];
}

/**
 * The first character as a capital.
 *
 * Each dish is its own spoken sentence, and a sentence that begins with a
 * lower-case "two" reads as a continuation of the one before it.
 */
function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** 'T1' stays 'T1'; 'Takeaway' gets its own sentence rather than a table. */
function isTakeaway(table: string): boolean {
  return /^takeaway$/i.test(table.trim()) || table.trim() === '';
}

/**
 * What the pass says when an order arrives.
 *
 * Table first, because that is the half the kitchen acts on -- who to walk the
 * food to. Then the dishes, with their portions. Then the guest's note, last
 * and clearly marked, because a note is a constraint ("no onion") rather than
 * another dish and must not be mistaken for one.
 *
 * Deliberately not the order code. A code is a reference for finding a bill
 * later; nobody carrying a plate needs to hear "MA-K3F9Q", and a kitchen
 * asked to remember one will get it wrong under pressure.
 */
export function newOrderText(table: string, items: SpeakableItem[], note?: string | null): string {
  const spoken = summariseItems(items);
  const clauses: string[] = [];

  if (isTakeaway(table)) clauses.push('New takeaway order.');
  else clauses.push(`New order, table ${table.trim()}.`);

  if (spoken.length > 0) {
    clauses.push(`${spoken.map((item) => capitalise(spokenItem(item))).join('. ')}.`);
  }

  const trimmedNote = (note ?? '').trim().replace(/\s+/g, ' ');
  if (trimmedNote) {
    const cut =
      trimmedNote.length > MAX_SPOKEN_NOTE
        ? `${trimmedNote.slice(0, MAX_SPOKEN_NOTE).trimEnd()}…`
        : trimmedNote;
    clauses.push(`Note: ${cut}.`);
  }

  return clauses.join(' ');
}

const ADVANCE_PHRASES: Record<string, (table: string) => string> = {
  preparing: (table) => `Table ${table}, now preparing.`,
  ready: (table) => `Table ${table} is ready.`,
  served: (table) => `Table ${table} served.`,
};

/** What the pass says when a ticket moves on. */
export function advanceText(table: string, next: string): string {
  const phrase = ADVANCE_PHRASES[next];
  if (phrase) return phrase(isTakeaway(table) ? 'takeaway' : table.trim());
  return `${table}, ${next}.`;
}

/**
 * The line shown in the on-screen log for one announcement.
 *
 * Kept separate from the spoken text so the log can be denser than the voice:
 * "T1 · 2 items" beats a full sentence read back to someone who just heard it.
 */
export function announceLogLabel(table: string, items: SpeakableItem[]): string {
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const where = isTakeaway(table) ? 'Takeaway' : table.trim();
  return `${where} · ${count} item${count === 1 ? '' : 's'}`;
}

/* ========================================================================== */
/*  What to announce when the board opens                                     */
/* ========================================================================== */

/**
 * A ticket, in the shape the board holds it. Deliberately structural rather
 * than importing KitchenTicket, so this module stays testable without a
 * database and the board stays free to shape its own rows.
 */
export type AnnounceableTicket = {
  /** Absent on demo rows, which have no database identity. */
  orderId?: string;
  table: string;
  placedAtIso?: string;
  note?: string;
  items: SpeakableItem[];
};

/** The full spoken sentence for one ticket. */
export function orderAnnouncement(ticket: AnnounceableTicket): string {
  return newOrderText(ticket.table, ticket.items, ticket.note);
}

/**
 * How recently an order must have been placed for the board to offer to read
 * it on open. Longer than this and the food is already out; the banner would
 * be telling the pass about work it has finished.
 */
export const MISSED_WINDOW_MS = 30 * 60 * 1000;

/**
 * What the board should do the first time it sees a list of tickets.
 *
 * THE FLOOD PROBLEM
 *
 * The board opens in the middle of service and the first payload contains
 * every open ticket of the last six hours. Treating those as "new" reads the
 * entire afternoon aloud in one go, and the first thing staff learn about the
 * feature is how to switch it off.
 *
 * So every ticket already on the board is marked as seen, silently. The ones
 * placed in the last half hour are returned separately, not because they are
 * silent, but because the board offers to read them on request -- the kitchen
 * may well want them, they just should not arrive as an ambush.
 *
 * Tickets restored from a previous session (a refresh, a wake from sleep) are
 * already in `seen` and are never offered again.
 */
export function primeOnOpen<T extends AnnounceableTicket>(
  tickets: T[],
  alreadySeen: Iterable<string>,
  now: number,
  windowMs: number = MISSED_WINDOW_MS,
): { seen: string[]; missed: T[] } {
  const seen = new Set<string>(alreadySeen);
  const missed: T[] = [];

  for (const ticket of tickets) {
    if (!ticket.orderId) continue; // demo row: nothing to remember
    if (seen.has(ticket.orderId)) continue;

    seen.add(ticket.orderId);

    const placed = ticket.placedAtIso ? new Date(ticket.placedAtIso).getTime() : NaN;
    if (!Number.isNaN(placed) && now - placed <= windowMs) missed.push(ticket);
  }

  return { seen: [...seen], missed };
}

/**
 * Tickets that are genuinely new since the last time the board looked.
 *
 * The id is the identity. An order is announced once when it appears and
 * never again because a poll happened to return it a second time.
 */
export function selectNewTickets<T extends AnnounceableTicket>(
  tickets: T[],
  seen: Iterable<string>,
): T[] {
  const known = new Set(seen);
  return tickets.filter((ticket) => ticket.orderId && !known.has(ticket.orderId));
}
