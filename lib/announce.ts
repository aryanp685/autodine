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
 *   1. the table, first, because that is who gets the plate
 *   2. the dishes, each with its portion and add-ons
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
export type Speaker = {
  /** Called for one announcement. Must call onEnd exactly once, even on error. */
  speak(text: string, onEnd: () => void): void;
};

/**
 * 'order' is a ticket the kitchen has not seen before: never dropped.
 * 'info' is a state change the board already shows on screen: dropped when
 * the queue is backed up, because six queued tickets matter more than hearing
 * that table two is now preparing.
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
  /**
   * Queue an announcement whether or not the key has been used, replacing any
   * copy still waiting. This is what a Replay button needs.
   */
  force(key: string, text: string, priority?: AnnouncePriority): boolean;
  /** Whether this key was announced before. Does not queue anything. */
  has(key: string): boolean;
  /** Forget a key, so the same announcement can be made again on request. */
  forget(key: string): void;
  /** Announcements waiting, not including the one speaking now. */
  pending(): number;
  /** Waiting plus the one being spoken. What the UI shows as "3 queued". */
  depth(): number;
  /** Whether something is being spoken right now. */
  speaking(): boolean;
}

/**
 * How many announcements may be waiting before informational ones start being
 * dropped. Four orders in a burst is the case this feature exists for and must
 * never be trimmed; beyond that the queue is describing the past.
 */
export const MAX_BACKLOG = 6;

/**
 * A hard ceiling on everything waiting, orders included.
 *
 * Orders are never dropped for being low priority, but an unbounded queue is
 * its own failure: a wedged engine plus a busy evening leaves an hour of
 * tickets waiting to be read out one after another, long after the food went
 * cold. At this depth the queue refuses, the board leaves those tickets
 * unmarked, and they are announced when it drains -- or offered for replay,
 * which is the honest outcome either way.
 */
export const MAX_PENDING = 20;

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
      // A speaker that throws must not wedge the queue for the rest of the
      // service: every later ticket would sit behind it for ever.
      finish();
    }
  }

  function enqueue(
    key: string,
    text: string,
    priority: AnnouncePriority,
    replaceWaiting: boolean,
  ): boolean {
    const body = text.trim();
    if (body === '') return false;

    if (said.has(key)) {
      if (!replaceWaiting) return false;
      said.delete(key);
    }

    const duplicate = waiting.findIndex((entry) => entry.text === body);
    if (duplicate >= 0) {
      if (!replaceWaiting) return false;
      waiting.splice(duplicate, 1);
    }

    if (waiting.length >= MAX_PENDING) return false;
    if (priority === 'info' && waiting.length >= MAX_BACKLOG) return false;

    waiting.push({ key, text: body, priority });
    drain();
    return true;
  }

  return {
    push: (key, text, priority = 'order') => enqueue(key, text, priority, false),
    force: (key, text, priority = 'order') => enqueue(key, text, priority, true),
    has: (key) => said.has(key),
    forget: (key) => {
      said.delete(key);
    },
    pending: () => waiting.length,
    depth: () => waiting.length + (busy ? 1 : 0),
    speaking: () => busy,
  };
}

/* ========================================================================== */
/*  Words                                                                     */
/* ========================================================================== */

/**
 * Portion and add-on words, as a kitchen says them.
 *
 * A variant is free text an owner typed, so anything unknown is spoken as it
 * is rather than guessed at.
 */
const DETAIL: Record<string, string> = {
  half: 'आधा',
  full: 'पूरा',
  quarter: 'पाव',
  regular: 'रेगुलर',
  small: 'छोटा',
  medium: 'मीडियम',
  large: 'बड़ा',
  single: 'सिंगल',
  double: 'डबल',
  plate: 'प्लेट',
  extra: 'एक्स्ट्रा',
  'extra cheese': 'एक्स्ट्रा चीज़',
  'extra spicy': 'ज़्यादा तीखा',
  'less spicy': 'कम तीखा',
};

/**
 * A table label as an Indian voice says it.
 *
 * 'T1' is printed on the table and must be spoken exactly. Devanagari
 * synthesisers disagree about Latin letters and digits -- some read them, some
 * spell them out, some skip them -- so every character is mapped to a
 * Devanagari syllable instead: 'T12' becomes 'टी ट्वेल्व' on every engine.
 *
 * Deliberately not the Hindi numerals used for quantities. A table labelled T1
 * is "टेबल टी वन"; nobody says "टेबल टी एक". The quantity on the ticket is a
 * different thing and does use Hindi numerals ("दो बटर चिकन"), so the two
 * lists cannot be shared.
 */
const LETTERS: Record<string, string> = {
  a: 'ए', b: 'बी', c: 'सी', d: 'डी', e: 'ई', f: 'एफ़', g: 'जी', h: 'एच', i: 'आई',
  j: 'जे', k: 'के', l: 'एल', m: 'एम', n: 'एन', o: 'ओ', p: 'पी', q: 'क्यू', r: 'आर',
  s: 'एस', t: 'टी', u: 'यू', v: 'वी', w: 'डब्ल्यू', x: 'एक्स', y: 'वाय', z: 'ज़ेड',
};

const LABEL_DIGITS = [
  'ज़ीरो', 'वन', 'टू', 'थ्री', 'फ़ोर', 'फ़ाइव', 'सिक्स', 'सेवन', 'एट', 'नाइन',
  'टेन', 'इलेवन', 'ट्वेल्व', 'थर्टीन', 'फ़ोर्टीन', 'फ़िफ़्टीन', 'सिक्स्टीन', 'सेवन्टीन',
  'एटीन', 'नाइन्टीन', 'ट्वेन्टी',
];

function labelDigits(chunk: string): string {
  const value = Number(chunk);

  // A table up to T20 is said as one number: "T12" is "टी ट्वेल्व".
  if (Number.isInteger(value) && value >= 0 && value <= 20) return LABEL_DIGITS[value];

  // Longer labels -- a hotel's "Room 204" -- are said digit by digit, which is
  // how a room number is spoken everywhere.
  return [...chunk].map((digit) => LABEL_DIGITS[Number(digit)] ?? digit).join(' ');
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

  const out: string[] = [];

  // One pass so 'T12' is T + the number twelve, not T + 1 + 2.
  for (const chunk of trimmed.match(/\d+|[^\d]/g) ?? []) {
    if (/^\d+$/.test(chunk)) {
      out.push(labelDigits(chunk));
      continue;
    }
    if (/\s/.test(chunk)) continue;
    out.push(LETTERS[chunk.toLowerCase()] ?? chunk);
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** How long a guest's note may be before it is cut. Spoken, not printed. */
export const MAX_SPOKEN_NOTE = 120;

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
export function spokenDetail(detail: string | undefined): string {
  const parts = (detail ?? '')
    .replace(/\s*·\s*/g, ', ')
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return '';

  return parts
    .map((part) => {
      const direct = DETAIL[part.toLowerCase()];
      if (direct) return direct;
      return toDevanagari(part);
    })
    .join(', ');
}

/**
 * One dish, as a clause: "दो बटर चिकन, आधा".
 *
 * The quantity is a word, the name is Devanagari, and the portion comes after
 * the dish -- the order a person says it in.
 */
export function spokenItem(item: SpeakableItem): string {
  const name = spokenName(item.name.trim(), item.spoken);
  const base = `${hindiNumber(item.qty)} ${name}`;
  const detail = spokenDetail(item.detail);

  return detail ? `${base}, ${detail}` : base;
}

/**
 * Cap on how many dishes are read out.
 *
 * A twelve-item order read in full takes long enough that two more orders land
 * while it is being spoken, and the kitchen stops listening somewhere around
 * the fourth dish. Shortening it is a real loss of information, so the
 * remainder is counted rather than dropped.
 */
export const MAX_SPOKEN_ITEMS = 4;

export function summariseItems<T extends SpeakableItem>(items: T[]): T[] {
  if (items.length <= MAX_SPOKEN_ITEMS) return items;

  const head = items.slice(0, MAX_SPOKEN_ITEMS);
  const rest = items.slice(MAX_SPOKEN_ITEMS);
  const tail = { qty: 0, name: `और ${hindiNumber(rest.length)} आइटम` };

  return [...head, tail as unknown as T];
}

/** The summary tail already carries its count, so it is not spoken with one. */
function spokenTail(item: SpeakableItem): string {
  return /^और /.test(item.name) ? item.name : spokenItem(item);
}

/**
 * What the pass says when an order arrives.
 *
 * Table first, because that is the half the kitchen acts on -- who to walk the
 * food to. Then the dishes with their portions. Then the guest's note, last
 * and labelled, because a note is a constraint ("प्याज़ नहीं") rather than
 * another dish and must not be mistaken for one.
 *
 * Deliberately not the order code. A code is a reference for finding a bill
 * later; nobody carrying a plate needs to hear "MA-K3F9Q", and a kitchen asked
 * to remember one will get it wrong under pressure.
 *
 * Sentences end in a danda so the voice can pace them -- see splitSentences.
 */
export function newOrderText(table: string, items: SpeakableItem[], note?: string | null): string {
  const clauses: string[] = [];

  clauses.push(isTakeaway(table) ? 'नया टेकअवे ऑर्डर।' : `नया ऑर्डर, टेबल ${spokenTable(table)}।`);

  const spoken = summariseItems(items.filter((item) => item.name.trim() !== ''));
  if (spoken.length > 0) {
    clauses.push(`${spoken.map(spokenTail).join('। ')}।`);
  }

  // A guest types "no onion." and the sentence already ends in a danda, so a
  // trailing full stop would be spoken as a second, empty sentence.
  const trimmedNote = (note ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?।]+$/, '');
  if (trimmedNote) {
    const cut =
      trimmedNote.length > MAX_SPOKEN_NOTE
        ? `${trimmedNote.slice(0, MAX_SPOKEN_NOTE).trimEnd()}…`
        : trimmedNote;
    // "ध्यान दें" rather than "नोट": a kitchen acts on a warning, and the
    // word is unmistakable over extractor fans.
    clauses.push(`ध्यान दें, ${noteToDevanagari(cut)}।`);
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
