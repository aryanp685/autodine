/**
 * Speaking orders out loud, one at a time -- and saying the RIGHT thing, in
 * the language the kitchen actually speaks.
 *
 * WHY A QUEUE AND NOT JUST speak()
 *
 * See lib/speech.ts. The short version: cancelling before each utterance cuts
 * every announcement but the last, and a burst of orders is exactly when that
 * matters.
 *
 * WHY TWO LANGUAGES
 *
 * An Indian kitchen does not talk in one language. The frame of the sentence
 * is Hindi; the dish names are whatever the menu calls them, usually English.
 * A board that reads out "New order, table T1" in a neutral accent is a board
 * the pass stops listening to within a week.
 *
 * BUT Hindi is not always available
 *
 * A laptop bought in the US has no hi-IN voice installed. Speaking Devanagari
 * at an English voice produces silence or gibberish, which is the worst
 * possible outcome: the board looks like it announced something and the
 * kitchen heard nothing at all. So the language is CHOSEN against what the
 * device can actually speak, never assumed -- see chooseLanguage and
 * resolveAnnouncement below. When the choice falls back, the board says so.
 */

/** A language this product can announce in. */
export type AnnounceLang = 'hi' | 'en';

/**
 * How the queue talks. Injected so the queue can be tested without a browser.
 *
 * The language travels WITH the announcement, not alongside the queue. A
 * kitchen board lets someone switch language while tickets are still waiting;
 * if the speaker looked up the current language at speak time, a queued Hindi
 * sentence would be handed to an English voice -- which reads Devanagari as
 * silence. Each entry therefore remembers how it was written.
 */
export type Speaker = {
  /**
   * Called for one announcement. Must call onEnd exactly once, even on error.
   *
   * `lang` is undefined when the caller never set one, and the speaker is then
   * free to use its default.
   */
  speak(text: string, onEnd: () => void, lang?: AnnounceLang): void;
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
  push(key: string, text: string, priority?: AnnouncePriority, lang?: AnnounceLang): boolean;
  /**
   * Queue an announcement whether or not the key has been used, and replacing
   * any copy of it still waiting.
   *
   * This is what a Replay button needs. Without the replacement a replay
   * pressed while the original is still queued is refused as a duplicate and
   * the button appears to do nothing.
   */
  force(key: string, text: string, priority?: AnnouncePriority, lang?: AnnounceLang): boolean;
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
  const waiting: { key: string; text: string; priority: AnnouncePriority; lang?: AnnounceLang }[] = [];
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
      speaker.speak(next.text, finish, next.lang);
    } catch {
      // A speaker that throws must not wedge the queue: without this the
      // board would announce once and then fall silent for the rest of the
      // service, which is indistinguishable from being switched off.
      finish();
    }
  }

  function enqueue(
    key: string,
    text: string,
    priority: AnnouncePriority,
    replaceWaiting: boolean,
    lang?: AnnounceLang,
  ): boolean {
    if (said.has(key) && !replaceWaiting) return false;

    const alreadyQueued = waiting.findIndex((entry) => entry.key === key);
    if (alreadyQueued >= 0) {
      if (!replaceWaiting) return false;
      waiting.splice(alreadyQueued, 1);
    }

    if (priority === 'info' && waiting.length >= MAX_BACKLOG) return false;

    if (replaceWaiting) said.delete(key);

    waiting.push({ key, text, priority, lang });
    drain();
    return true;
  }

  return {
    push: (key, text, priority = 'order', lang) => enqueue(key, text, priority, false, lang),
    force: (key, text, priority = 'order', lang) => enqueue(key, text, priority, true, lang),
    has: (key) => said.has(key),
    forget: (key) => said.delete(key),
    pending: () => waiting.length,
    depth: () => waiting.length + (busy ? 1 : 0),
    speaking: () => busy,
  };
}

/* ========================================================================== */
/*  Choosing a language                                                       */
/* ========================================================================== */

export type LanguageChoice = {
  /** The language the text will actually be spoken in. */
  lang: AnnounceLang;
  /** True when the preference could not be honoured and English is used. */
  fellBack: boolean;
};

/**
 * Pick the language to announce in, given what the device can speak.
 *
 * The rule is one line long on purpose: never ask a voice to read a script it
 * cannot read. Hindi text at an English synthesiser is not "a bit accented",
 * it is silence -- and a silent board that believes it spoke is the failure
 * this whole module exists to prevent.
 */
export function chooseLanguage(preferred: AnnounceLang, hindiAvailable: boolean): LanguageChoice {
  if (preferred === 'hi' && !hindiAvailable) return { lang: 'en', fellBack: true };
  return { lang: preferred, fellBack: false };
}

/* ========================================================================== */
/*  Words                                                                     */
/* ========================================================================== */

const EN_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];

const HI_NUMBERS = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस',
  'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस', 'बीस',
];

/**
 * A count as a word.
 *
 * Speech engines read a bare digit as a digit and hang a pause on it: "2.
 * Butter Chicken" comes out stilted and slow. A word flows. Above twenty the
 * digit is clearer than a long phrase, so it is left as digits.
 */
export function numberWord(n: number, lang: AnnounceLang = 'en'): string {
  const rounded = Math.round(n);
  if (!Number.isFinite(rounded) || rounded < 0) return String(n);

  const words = lang === 'hi' ? HI_NUMBERS : EN_NUMBERS;
  return rounded <= 20 ? words[rounded] : String(rounded);
}

/**
 * Portion names, translated.
 *
 * A variant is free text an owner typed, so anything unknown is spoken as-is
 * rather than guessed at. These are the ones that actually appear on Indian
 * menus, including the Bombay "paav" for a quarter.
 */
const HI_DETAIL: Record<string, string> = {
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
};

function translateDetail(detail: string, lang: AnnounceLang): string {
  if (lang === 'en') return detail;

  return detail
    .split(/\s*,\s*/)
    .map((part) => {
      const key = part.trim().toLowerCase();
      return HI_DETAIL[key] ?? part.trim();
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * A table label as an Indian voice can definitely pronounce it.
 *
 * 'T1' is printed on the table and must be spoken exactly, but Devanagari
 * synthesisers disagree about Latin letters and digits -- some read them, some
 * spell them out letter by letter, some skip them. Every character is mapped
 * to a Devanagari syllable instead, so 'T12' becomes 'टी बारह' on every
 * engine: letters by their Indian names, digits the way a person says "T one
 * two" -- actually "T twelve", because that is what the label means.
 */
const HI_LETTERS: Record<string, string> = {
  a: 'ए', b: 'बी', c: 'सी', d: 'डी', e: 'ई', f: 'एफ़', g: 'जी', h: 'एच', i: 'आई',
  j: 'जे', k: 'के', l: 'एल', m: 'एम', n: 'एन', o: 'ओ', p: 'पी', q: 'क्यू', r: 'आर',
  s: 'एस', t: 'टी', u: 'यू', v: 'वी', w: 'डब्ल्यू', x: 'एक्स', y: 'वाय', z: 'ज़ेड',
};

/**
 * Digits as Indians say a TABLE NUMBER.
 *
 * Deliberately not the Hindi numerals used for quantities. A table labelled
 * T1 is "टेबल टी वन" -- nobody says "टेबल टी एक". The quantity on the ticket
 * is a different thing and does use Hindi numerals ("दो Butter Chicken"), so
 * the two lists cannot be shared.
 */
const HI_LABEL_DIGITS = [
  'ज़ीरो', 'वन', 'टू', 'थ्री', 'फ़ोर', 'फ़ाइव', 'सिक्स', 'सेवन', 'एट', 'नाइन',
  'टेन', 'इलेवन', 'ट्वेल्व', 'थर्टीन', 'फ़ोर्टीन', 'फ़िफ़्टीन', 'सिक्स्टीन', 'सेवन्टीन',
  'एटीन', 'नाइन्टीन', 'ट्वेन्टी',
];

function labelDigits(chunk: string): string {
  const value = Number(chunk);

  // A table up to T20 is said as one number; "T12" is "टी ट्वेल्व".
  if (Number.isInteger(value) && value >= 0 && value <= 20) return HI_LABEL_DIGITS[value];

  // Longer labels -- a hotel's "Room 204" -- are said digit by digit, which
  // is how a room number is spoken everywhere.
  return [...chunk].map((digit) => HI_LABEL_DIGITS[Number(digit)] ?? digit).join(' ');
}

/**
 * A table label spoken in Hindi.
 *
 * A run of digits is spoken the way the table number is said, not one digit
 * at a time for a normal number and not as a Hindi numeral.
 */
export function spokenTable(table: string, lang: AnnounceLang): string {
  const trimmed = table.trim();
  if (trimmed === '') return lang === 'hi' ? 'टेकअवे' : 'Takeaway';

  if (lang === 'en') return trimmed;

  if (/^(takeaway|take away|counter)$/i.test(trimmed)) return 'टेकअवे';

  const out: string[] = [];
  // One pass so 'T12' is T + the number 12, not T + 1 + 2.
  for (const chunk of trimmed.match(/\d+|[^\d]/g) ?? []) {
    if (/^\d+$/.test(chunk)) {
      out.push(labelDigits(chunk));
      continue;
    }
    const letter = HI_LETTERS[chunk.toLowerCase()];
    out.push(letter ?? chunk);
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
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
 * The separators in `detail` are the middot the ticket card uses; a voice
 * reads a middot as nothing at all, so it becomes a comma.
 */
export function spokenItem(item: SpeakableItem, lang: AnnounceLang = 'en'): string {
  const base = `${numberWord(item.qty, lang)} ${item.name}`;

  const detail = translateDetail(
    (item.detail ?? '').replace(/\s*·\s*/g, ', ').replace(/\s+/g, ' ').trim(),
    lang,
  );

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

export function summariseItems<T extends SpeakableItem>(items: T[], lang: AnnounceLang = 'en'): T[] {
  if (items.length <= MAX_SPOKEN_ITEMS) return items;

  const head = items.slice(0, MAX_SPOKEN_ITEMS);
  const rest = items.slice(MAX_SPOKEN_ITEMS);
  const extraQty = rest.reduce((sum, i) => sum + i.qty, 0);

  const tail =
    lang === 'hi'
      ? { qty: 0, name: `और ${numberWord(rest.length, 'hi')} आइटम` }
      : { qty: extraQty, name: `more item${rest.length === 1 ? '' : 's'}` };

  // Cast because the tail is a plain summary rather than a real dish: it has
  // a quantity and a name and nothing else, which is all the reader needs.
  return [...head, tail as unknown as T];
}

/** The tail's own quantity is zero when the count is already in its name. */
function spokeSummaryTail(item: SpeakableItem, lang: AnnounceLang): string {
  if (lang === 'hi' && /^और /.test(item.name)) return item.name;
  return spokenItem(item, lang);
}

function isTakeaway(table: string): boolean {
  const trimmed = table.trim();
  return trimmed === '' || /^(takeaway|take away|counter)$/i.test(trimmed);
}

/**
 * The first character as a capital. English only; Devanagari has no case, and
 * a Hindi sentence that begins with one is already a sentence.
 */
function capitalise(text: string, lang: AnnounceLang): string {
  if (lang === 'hi' || text.length === 0) return text;
  return text[0].toUpperCase() + text.slice(1);
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
export function newOrderText(
  table: string,
  items: SpeakableItem[],
  note?: string | null,
  lang: AnnounceLang = 'en',
): string {
  const spoken = summariseItems(items, lang);
  const clauses: string[] = [];

  const where = spokenTable(table, lang);

  if (lang === 'hi') {
    clauses.push(isTakeaway(table) ? 'नया टेकअवे ऑर्डर।' : `नया ऑर्डर, टेबल ${where}।`);
    if (spoken.length > 0) {
      const dishes = spoken
        .map((item) => (/^और /.test(item.name) ? spokeSummaryTail(item, lang) : spokenItem(item, lang)))
        .join('। ');
      clauses.push(`${dishes}।`);
    }
  } else {
    clauses.push(isTakeaway(table) ? 'New takeaway order.' : `New order, table ${where}.`);
    if (spoken.length > 0) {
      const dishes = spoken
        .map((item) => capitalise(spokenItem(item, lang), lang))
        .join('. ');
      clauses.push(`${dishes}.`);
    }
  }

  const trimmedNote = (note ?? '').trim().replace(/\s+/g, ' ');
  if (trimmedNote) {
    const cut =
      trimmedNote.length > MAX_SPOKEN_NOTE
        ? `${trimmedNote.slice(0, MAX_SPOKEN_NOTE).trimEnd()}…`
        : trimmedNote;
    clauses.push(lang === 'hi' ? `नोट: ${cut}।` : `Note: ${cut}.`);
  }

  return clauses.join(' ');
}

const EN_ADVANCE: Record<string, { table: (t: string) => string; takeaway: string }> = {
  preparing: { table: (t) => `Table ${t}, now preparing.`, takeaway: 'The takeaway order is being prepared.' },
  ready: { table: (t) => `Table ${t} is ready.`, takeaway: 'The takeaway order is ready.' },
  served: { table: (t) => `Table ${t} served.`, takeaway: 'The takeaway order has been served.' },
};

const HI_ADVANCE: Record<string, { table: (t: string) => string; takeaway: string }> = {
  preparing: { table: (t) => `टेबल ${t}, बनना शुरू।`, takeaway: 'टेकअवे ऑर्डर बन रहा है।' },
  ready: { table: (t) => `टेबल ${t} तैयार है।`, takeaway: 'टेकअवे ऑर्डर तैयार है।' },
  served: { table: (t) => `टेबल ${t} सर्व हो गया।`, takeaway: 'टेकअवे ऑर्डर सर्व हो गया।' },
};

/**
 * What the pass says when a ticket moves on.
 *
 * A takeaway ticket has no table, and "Table takeaway, now preparing" is what
 * a naive template produces -- a sentence that is not just clumsy but wrong,
 * because a cook listening for a table number hears one that does not exist.
 */
export function advanceText(table: string, next: string, lang: AnnounceLang = 'en'): string {
  const phrases = lang === 'hi' ? HI_ADVANCE : EN_ADVANCE;
  const where = spokenTable(table, lang);

  const phrase = phrases[next];
  if (phrase) return isTakeaway(table) ? phrase.takeaway : phrase.table(where);

  return lang === 'hi' ? `टेबल ${where}, ${next}।` : `Table ${where}, ${next}.`;
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
export function orderAnnouncement(ticket: AnnounceableTicket, lang: AnnounceLang = 'en'): string {
  return newOrderText(ticket.table, ticket.items, ticket.note, lang);
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
