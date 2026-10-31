/**
 * What the kitchen hears, and the order it hears it in.
 *
 * ONE LANGUAGE, ONE PATH
 *
 * The board speaks Hindi. Not "Hindi with an English fallback" -- that
 * fallback is how a Hindi kitchen ends up listening to an English robot
 * reading "do Butter Chicken" in the accent of a satnav, or, worse, hearing
 * nothing at all because the engine was handed Devanagari it could not read.
 * There is exactly one sentence builder and exactly one voice, so there is
 * nothing to get out of sync and no path where the words are in one language
 * and the voice in another.
 *
 * WHAT A SENTENCE IS MADE OF
 *
 *   1. one greeting that names the new ticket and the table it is for
 *   2. the dishes, each as how many, how much of it, and what it is -- then
 *      any add-on that was asked for on top
 *   3. the guest's note, last and labelled
 *
 * Every word of it is Devanagari by the time it reaches the voice -- see
 * lib/hindi.ts for why that matters and how dish names get there.
 *
 * WHY A QUEUE
 *
 * Cancelling before each utterance cuts every announcement but the last, and a
 * burst of orders is exactly when that matters. Four orders in the same second
 * must produce four complete announcements, in arrival order.
 */

import { hindiNumber, noteToDevanagari, spokenName, toDevanagari } from './hindi';

/**
 * How the queue talks. Injected so the queue can be tested without a browser.
 *
 * The speaker is handed the finished Devanagari sentence. It is responsible
 * for the voice, the pacing and the watchdog -- never for the wording.
 */
import type { SpeechOutcome } from './speech';

export type Speaker = {
  /** Calls back once, and distinguishes completed speech from an error. */
  speak(text: string, onEnd: (outcome: SpeechOutcome) => void): void;
};

export type AnnouncePriority = 'order' | 'info';
export type EnqueueResult = 'queued' | 'duplicate' | 'full' | 'empty';

export type QueuedAnnouncement = {
  key: string;
  text: string;
  priority: AnnouncePriority;
};

export type AnnounceQueue = {
  /** A stable event key may be queued at most once until an explicit retry. */
  push(key: string, text: string, priority?: AnnouncePriority): EnqueueResult;
  /** Explicit replay: caller supplies a fresh attempt key. */
  force(key: string, text: string, priority?: AnnouncePriority): EnqueueResult;
  /** Whether this key has completed successfully. */
  has(key: string): boolean;
  /** Whether this key is completed, waiting, speaking, or failed. */
  contains(key: string): boolean;
  /** Forget a failed/completed key, for a deliberate retry using that key. */
  forget(key: string): void;
  pending(): number;
  depth(): number;
  speaking(): boolean;
  dispose(): void;
};

export const MAX_BACKLOG = 6;
export const MAX_PENDING = 20;

export type QueueHooks = {
  onBegin?: (entry: QueuedAnnouncement) => void;
  onResult?: (entry: QueuedAnnouncement, outcome: SpeechOutcome) => void;
  onIdle?: () => void;
};

/**
 * FIFO speech queue. Deduplication is by event key, not by text: two genuine
 * orders can have identical contents, while a refresh of one order must not
 * create a second enqueue. A failed attempt remains known until explicitly
 * replayed, but is not reported as completed.
 */
export function createAnnounceQueue(speaker: Speaker, hooks: QueueHooks = {}): AnnounceQueue {
  const waiting: QueuedAnnouncement[] = [];
  const completed = new Set<string>();
  const failed = new Set<string>();
  const queued = new Set<string>();
  let active: QueuedAnnouncement | null = null;
  let disposed = false;

  function notifyIdle(): void {
    try { hooks.onIdle?.(); } catch { /* UI observers cannot wedge speech */ }
  }

  function finish(entry: QueuedAnnouncement, outcome: SpeechOutcome): void {
    if (active?.key !== entry.key) return;
    active = null;
    queued.delete(entry.key);
    if (outcome.status === 'completed') completed.add(entry.key);
    else if (outcome.status === 'failed') failed.add(entry.key);

    try { hooks.onResult?.(entry, outcome); } catch { /* keep draining */ }
    drain();
    if (!active && waiting.length === 0) notifyIdle();
  }

  function drain(): void {
    if (disposed || active) return;
    const next = waiting.shift();
    if (!next) return;
    active = next;

    try { hooks.onBegin?.(next); } catch { /* keep the speaker independent */ }
    try {
      speaker.speak(next.text, (outcome) => finish(next, outcome));
    } catch (error) {
      finish(next, {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Speech engine threw an error',
        completedSegments: 0,
        totalSegments: 1,
      });
    }
  }

  function enqueue(key: string, text: string, priority: AnnouncePriority, force: boolean): EnqueueResult {
    const body = text.trim();
    if (!body) return 'empty';
    if (queued.has(key) || (!force && (completed.has(key) || failed.has(key)))) return 'duplicate';
    if (depth() >= MAX_PENDING || (priority === 'info' && waiting.length >= MAX_BACKLOG)) return 'full';
    if (force) {
      completed.delete(key);
      failed.delete(key);
    }

    const entry = { key, text: body, priority };
    queued.add(key);
    waiting.push(entry);
    drain();
    return 'queued';
  }

  function depth(): number { return waiting.length + (active ? 1 : 0); }

  return {
    push: (key, text, priority = 'order') => enqueue(key, text, priority, false),
    force: (key, text, priority = 'order') => enqueue(key, text, priority, true),
    has: (key) => completed.has(key),
    contains: (key) => queued.has(key) || completed.has(key) || failed.has(key),
    forget: (key) => { completed.delete(key); failed.delete(key); },
    pending: () => waiting.length,
    depth,
    speaking: () => active !== null,
    dispose() {
      disposed = true;
      waiting.length = 0;
      queued.clear();
      active = null;
    },
  };
}

/* ========================================================================== */
/*  Words                                                                     */
/* ========================================================================== */

/**
 * Portion words, as a kitchen says them -- and they come BEFORE the dish.
 *
 * Quantity and portion stay attached to the dish name. For the common menu
 * variants "Half" and "Full", Mumbai kitchens naturally use "हाफ" and "फुल"
 *; measured portions use proper Hindi ("आधी प्लेट", "आधा किलो"). This keeps
 * the quantity, size and dish in one phrase without making a portion sound like
 * a second item.
 *
 * "पाव" is Bombay for a quarter and is what the kitchen actually calls it; the
 * menu can say "Quarter".
 */
const PORTION: Record<string, string> = {
  // Bombay kitchens commonly call menu portions "half" and "full"; these
  // short Hinglish forms are clearer than the grammatically awkward "एक आधा
  // बटर चिकन". Measured variants below remain proper Hindi (आधी प्लेट, आधा किलो).
  half: 'हाफ',
  full: 'फुल',
  quarter: 'पाव',
  regular: 'रेगुलर',
  small: 'छोटा',
  medium: 'मीडियम',
  large: 'बड़ा',
  single: 'सिंगल',
  double: 'डबल',
  plate: 'प्लेट',

  // A portion is usually written as a measure, not a bare adjective: menus say
  // "Half Plate", "Full Plate", "Half Kg". Read as two unknown words that
  // becomes "आधा प्लेट" -- which in Hindi is the wrong gender and, worse, gets
  // filed as an ADD-ON, so it trails the dish and sounds like a second item:
  // "एक बटर नान, आधा प्लेट". Composed forms are listed whole, with the gender
  // the measure word actually takes, because "आधी प्लेट" is a plate and
  // "आधा प्लेट" is an accent.
  'half plate': 'आधी प्लेट',
  'full plate': 'पूरी प्लेट',
  'quarter plate': 'पाव प्लेट',
  'half bowl': 'आधा बाउल',
  'full bowl': 'पूरा बाउल',
  'half katori': 'आधी कटोरी',
  'full katori': 'पूरी कटोरी',
  'half kg': 'आधा किलो',
  'half kilo': 'आधा किलो',
  'full kg': 'एक किलो',
  'full kilo': 'एक किलो',
  'one kg': 'एक किलो',
  'half litre': 'आधा लीटर',
  'half liter': 'आधा लीटर',
  'full litre': 'एक लीटर',
  'full liter': 'एक लीटर',
  'half glass': 'आधा ग्लास',
  'full glass': 'पूरा ग्लास',
  'half bottle': 'आधी बोतल',
  'full bottle': 'पूरी बोतल',
  'half pack': 'आधा पैक',
  'full pack': 'पूरा पैक',

  // The bare measures, for "Plate" or "1 Kg" written on their own.
  kg: 'किलो',
  kilo: 'किलो',
  gram: 'ग्राम',
  grams: 'ग्राम',
  gm: 'ग्राम',
  gms: 'ग्राम',
  ml: 'मिली',
  litre: 'लीटर',
  liter: 'लीटर',
  bowl: 'बाउल',
  katori: 'कटोरी',
  glass: 'ग्लास',
  bottle: 'बोतल',
  pack: 'पैक',
};

/**
 * Add-on words, and they come AFTER the dish.
 *
 * "दो बटर नान, एक्स्ट्रा चीज़" -- an add-on is an instruction about the dish
 * that was just named, so it trails it the way a request does.
 */
const ADDON: Record<string, string> = {
  extra: 'एक्स्ट्रा',
  'extra cheese': 'एक्स्ट्रा चीज़',
  'extra spicy': 'ज़्यादा तीखा',
  'less spicy': 'कम तीखा',
};

/**
 * Everything the board knows how to say about a dish's detail line.
 *
 * A variant is free text an owner typed, so anything unknown is spoken as it
 * is rather than guessed at -- that is what keeps a menu this module has never
 * seen from being silently mispronounced or dropped.
 */
const DETAIL: Record<string, string> = { ...PORTION, ...ADDON };

/**
 * A table label as an Indian voice says it.
 *
 * Table labels and ticket quantities share Hindi number pronunciation. The
 * alphabetic prefix is read as a Hindi letter name; numeric parts use Hindi
 * number words so the same table is never pronounced in two different ways.
 */
const LETTERS: Record<string, string> = {
  a: 'ए', b: 'बी', c: 'सी', d: 'डी', e: 'ई', f: 'एफ़', g: 'जी', h: 'एच', i: 'आई',
  j: 'जे', k: 'के', l: 'एल', m: 'एम', n: 'एन', o: 'ओ', p: 'पी', q: 'क्यू', r: 'आर',
  s: 'एस', t: 'टी', u: 'यू', v: 'वी', w: 'डब्ल्यू', x: 'एक्स', y: 'वाय', z: 'ज़ेड',
};

function labelDigits(chunk: string): string {
  const value = Number(chunk);
  // Table labels use Hindi number words consistently: T1, T21 and Room 204
  // never switch to English number words depending on label shape.
  if (Number.isSafeInteger(value) && value >= 0 && value <= 99) return hindiNumber(value);
  return [...chunk].map((digit) => hindiNumber(Number(digit))).join(' ');
}

/** Whether a table label means "no table" rather than naming one. */
export function isTakeaway(table: string): boolean {
  const trimmed = table.trim();
  return trimmed === '' || /^(takeaway|take away|counter|parcel)$/i.test(trimmed);
}

/** A table label spoken in Devanagari. */
export function spokenTable(table: string): string {
  const trimmed = table.trim();
  if (isTakeaway(table)) return 'टेकअवे';

  // "T2" is how the card is PRINTED -- the T is the word "Table", not part of
  // the name. The sentence around this already says "टेबल" / "टेबल नंबर", so
  // spelling the T gives "टेबल नंबर टी दो", which a kitchen hears as "t2"
  // instead of "table number two". The number is what matters, and it is said
  // as the Hindi word: T2 -> दो, T12 -> बारह. A letter that is NOT this
  // abbreviation -- a section mark like "A2" -- is kept and spelled, because
  // that one is information.
  const printed = trimmed.match(/^(?:table|t)[\s.\-–—]*([0-9]+)$/i);
  if (printed) return labelDigits(printed[1]);

  const out: string[] = [];

  // One pass so 'T12' is T + the number twelve, not T + 1 + 2.
  for (const chunk of trimmed.match(/\d+|[^\d\s]+/g) ?? []) {
    if (/^\d+$/.test(chunk)) {
      out.push(labelDigits(chunk));
      continue;
    }

    // A run of three letters or more is a word -- "Room 204", "Garden" -- and
    // is said as one: spelling it gives "आर ओ ओ एम", which is four letters,
    // not a room. Shorter runs are labels and acronyms and are spelled: the
    // printed table says "T1", and a table is never "टी" + a word.
    if (chunk.length >= 3) {
      out.push(toDevanagari(chunk));
      continue;
    }

    for (const letter of chunk) out.push(LETTERS[letter.toLowerCase()] ?? letter);
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** The saved guest note, spoken in full after whitespace is normalized. */
export type SpeakableItem = {
  qty: number;
  name: string;
  /** "Half · Butter naan" -- the portion and any add-ons, as shown. */
  detail?: string;
  /**
   * The restaurant's own written pronunciation of the dish, if it has one.
   *
   * A rule transliteration is right often and wrong sometimes, and only the
   * owner knows which. When a name has been set in the menu editor it is what
   * the kitchen hears -- the dish is never quietly renamed by the algorithm.
   */
  spoken?: string | null;
};

/**
 * A dish's detail parts, translated where they are a portion or a known
 * add-on, and left to the transliterator where they are anything else.
 */
function detailParts(detail: string | undefined): string[] {
  return (detail ?? '')
    .replace(/\s*·\s*/g, ', ')
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** One detail word in Devanagari: a known word if we have it, as written if not. */
function spokenPart(part: string): string {
  return DETAIL[part.toLowerCase()] ?? toDevanagari(part);
}

/** The whole detail line, in the order it was written. */
export function spokenDetail(detail: string | undefined): string {
  return detailParts(detail).map(spokenPart).join(', ');
}

/** The portions on a dish, said before its name: "आधा" from "Half · Extra cheese". */
export function spokenPortion(detail: string | undefined): string {
  return detailParts(detail)
    .filter((part) => PORTION[part.toLowerCase()] !== undefined)
    .map((part) => PORTION[part.toLowerCase()]!)
    .join(' ');
}

/** The add-ons on a dish, said after its name: "एक्स्ट्रा चीज़". */
export function spokenAddons(detail: string | undefined): string {
  return detailParts(detail)
    .filter((part) => PORTION[part.toLowerCase()] === undefined)
    .map(spokenPart)
    .join(', ');
}

/**
 * One dish, as a clause: "एक आधा बटर चिकन, एक्स्ट्रा चीज़".
 *
 * The order is the order a person says it in -- how many, how much of it, what
 * it is, and then anything extra asked for on top. Quantity and portion are
 * words, the name is Devanagari, and only the add-ons trail the dish.
 */
export function spokenItem(item: SpeakableItem): string {
  const sourceName = item.name.trim();
  const name = sourceName ? spokenName(sourceName, item.spoken) : 'आइटम';
  const portion = spokenPortion(item.detail);
  const addons = spokenAddons(item.detail);

  const base = [hindiNumber(item.qty), portion, name].filter(Boolean).join(' ');
  return addons ? `${base}, ${addons}` : base;
}

/**
 * What the pass says when an order arrives.
 *
 * The table is named in the first heartbeat, because it is the half the
 * kitchen acts on -- who to walk the food to. Then the dishes, portion first
 * so it stays attached to the dish. Then the guest's note, last and labelled,
 * because a note is a constraint ("प्याज़ नहीं") rather than another dish and
 * must not be mistaken for one.
 *
 * Deliberately not the order code. A code is a reference for finding a bill
 * later; nobody carrying a plate needs to hear "MA-K3F9Q", and a kitchen asked
 * to remember one will get it wrong under pressure.
 *
 * Sentences end in a danda so the voice can pace them -- see splitSentences.
 */
export function newOrderText(table: string, items: SpeakableItem[], note?: string | null): string {
  const clauses: string[] = [];

  if (isTakeaway(table)) {
    clauses.push('नया टेकअवे ऑर्डर आया है।');
  } else {
    clauses.push('नया ऑर्डर आया है।');
    clauses.push(`टेबल ${spokenTable(table)}।`);
  }

  // Pair dishes into conversational phrases. A long ticket becomes a few
  // short utterances instead of a rushed item-by-item recital; every saved
  // quantity, name, portion and add-on remains in its original item phrase.
  // Replay remains available if any chunk is interrupted.
  for (let index = 0; index < items.length; index += 2) {
    const group = items.slice(index, index + 2).map(spokenItem);
    clauses.push(`${group.join(' और ')}।`);
  }

  // A guest types "no onion." and the sentence already ends in a danda, so a
  // trailing full stop would be spoken as a second, empty sentence.
  const trimmedNote = (note ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?।]+$/, '');
  if (trimmedNote) {
    // Said directly, as the guest's own instruction: "प्याज़ नहीं", "तीखा बनाना".
    // No label -- "ध्यान देना", "नोट" -- because a label is a word that is
    // neither the order nor the note, and the note is already phrased as
    // something a cook acts on.
    clauses.push(`${noteToDevanagari(trimmedNote)}।`);
  }

  return clauses.join(' ');
}

const ADVANCE: Record<string, { table: (t: string) => string; takeaway: string }> = {
  preparing: { table: (t) => `टेबल ${t}, बनना शुरू।`, takeaway: 'टेकअवे ऑर्डर बन रहा है।' },
  ready: { table: (t) => `टेबल ${t} तैयार है।`, takeaway: 'टेकअवे ऑर्डर तैयार है।' },
  served: { table: (t) => `टेबल ${t} सर्व हो गया।`, takeaway: 'टेकअवे ऑर्डर सर्व हो गया।' },
};

/**
 * What the pass says when a ticket moves on.
 *
 * A takeaway ticket has no table, and "टेबल टेकअवे" is what a naive template
 * produces -- a sentence that is not just clumsy but wrong, because a cook
 * listening for a table number hears one that does not exist.
 */
export function advanceText(table: string, next: string): string {
  const phrase = ADVANCE[next];
  if (phrase) return isTakeaway(table) ? phrase.takeaway : phrase.table(spokenTable(table));

  return `टेबल ${spokenTable(table)}, ${toDevanagari(next)}।`;
}

/**
 * What the pass says when a ticket is cancelled.
 *
 * A cancellation is not a state change the board can show quietly: a cook may
 * already have the pan on. It is spoken at 'order' priority, because dropping
 * it under load is exactly how food gets made for an order that no longer
 * exists.
 *
 * "का ऑर्डर" rather than "ऑर्डर," -- without the possessive the sentence reads
 * as though the whole restaurant's orders were cancelled.
 */
export function cancelText(table: string): string {
  if (isTakeaway(table)) return 'टेकअवे ऑर्डर कैंसल हो गया।';
  return `टेबल ${spokenTable(table)} का ऑर्डर कैंसल हो गया।`;
}

/**
 * The line shown in the on-screen log for one announcement.
 *
 * Kept separate from the spoken text so the log can be denser than the voice:
 * "T1 · 2 आइटम" beats a full sentence read back to someone who just heard it.
 */
export function announceLogLabel(table: string, items: SpeakableItem[]): string {
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const where = isTakeaway(table) ? 'Takeaway' : table.trim();
  return `${where} · ${count} आइटम`;
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
 * silent, but because the board offers to read them on request.
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
 * The id is the identity. An order is announced once when it appears and never
 * again because a poll happened to return it a second time.
 */
export function selectNewTickets<T extends AnnounceableTicket>(
  tickets: T[],
  seen: Iterable<string>,
): T[] {
  const known = new Set(seen);
  return tickets.filter((ticket) => ticket.orderId && !known.has(ticket.orderId));
}
