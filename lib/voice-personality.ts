/**
 * The kitchen voice, as a personality.
 *
 * A TTS engine reads text aloud. It cannot act. So the funny, warm, desi
 * personality lives in the words -- how an order is framed, punctuated and
 * segmented before it reaches the engine. The same engine, given plain text,
 * sounds like a robot. Given this text, it sounds like a person.
 *
 * ORDER DATA AND EXPRESSIVE WORDING ARE SEPARATE
 *
 * The dynamic part -- table number, dish names, quantities, guest note -- is
 * always taken from the order as-is, through the same spokenItem and
 * spokenTable helpers the plain announcement uses. The expressive part --
 * openers, transitions, closers, slang -- comes from templates below. They
 * never share a string, so a joke cannot corrupt an allergy note.
 *
 * VARIATION
 *
 * A kitchen that hears "arey mama" on every ticket learns to ignore it.
 * Variations rotate so the voice feels like a person, not a loop. The caller
 * passes a variation index; the same order announced twice sounds different.
 *
 * SAY THE ORDER. SAY THE NOTE. SAY NOTHING ELSE.
 *
 * The kitchen operator is working. The announcement exists to deliver
 * two facts: what order arrived (where from, which dishes) and the
 * guest's note if there is one. No openers, no closers, no jokes, no
 * "start now" -- anything beyond the order and the note is chatter, and
 * chatter is what makes a voice annoying. The five variations differ
 * only in how they phrase the order's arrival, so consecutive
 * announcements do not sound like the same recording on a loop. The
 * "और" before the last dish stays because that is how a list of dishes
 * is said -- it is part of saying the order, not decoration.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 * It does not pick an engine. The text it returns works with Edge TTS, Piper,
 * the browser Web Speech API or any engine that reads Hindi. The personality
 * is in the words; the voice is the engine's job.
 */

import {
  spokenItem,
  spokenTable,
  isTakeaway,
  type SpeakableItem,
} from './announce';
import { noteToDevanagari } from './hindi';

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

/**
 * One personality variation.
 *
 * Each variation is a complete framing: how it opens, how it introduces the
 * dishes, and how it closes. The dynamic data -- table,
 * items, note -- is injected by the variation's functions, so the variation
 * only controls the expressive wording around it.
 */
export type PersonalityVariation = {
  /** Stable identifier, used for testing and debugging. */
  id: string;
  /** The opening line, including the table if there is one. */
  opener: (table: string, dialect?: AnnouncementDialect) => string;
  /** A short transition before the dish list. */
  itemsIntro: () => string;
  /** Separator between dish phrases. */
  itemsSeparator: () => string;
  /** The closing line. */
  closer: () => string;
};

/** The style of announcement to generate. */
export type AnnouncementStyle = 'expressive' | 'standard';

/* ========================================================================== */
/*  Variations                                                                */
/* ========================================================================== */

/**
 * DESI DIALECTS -- how a local says the same facts.
 *
 * The kitchen asked for a voice that sounds like the room it works in:
 * Nagpuri or Mumbai Hindi, not textbook Hindi. So the arrival line is
 * written twice, once per dialect, and the operator picks. Both say exactly
 * the same facts -- which table, that a new order arrived -- in the words
 * each dialect actually uses: "वर / नवा / आय" in Nagpuri, "पे / आ गया" in
 * Mumbai. No slang words: a dialect is grammar and word choice, not
 * interjections. The banned-words tests below run against BOTH.
 *
 * The safety voice ('standard') does NOT vary by dialect. A note about
 * allergies is read in plain Hindi whatever the setting -- clarity for a
 * constraint beats flavour every time.
 */
export type AnnouncementDialect = 'nagpuri' | 'mumbai';

export const DEFAULT_DIALECT: AnnouncementDialect = 'nagpuri';

export const DIALECT_LABELS: Record<AnnouncementDialect, string> = {
  nagpuri: 'नागपुरी',
  mumbai: 'बमइया',
};

type DialectOpeners = {
  /** Four arrival phrases per dialect, one per expressive variation. */
  table: ReadonlyArray<(t: string) => string>;
  takeaway: ReadonlyArray<() => string>;
};

const DIALECT_OPENERS: Record<AnnouncementDialect, DialectOpeners> = {
  nagpuri: {
    table: [
      (t) => `टेबल नंबर ${t} वर नवा ऑर्डर आय।`,
      (t) => `नवा ऑर्डर आय, टेबल नंबर ${t}।`,
      (t) => `टेबल ${t} से ऑर्डर आय।`,
      (t) => `टेबल नंबर ${t} के ऑर्डर आय।`,
    ],
    takeaway: [
      () => 'टेकअवे वर नवा ऑर्डर आय।',
      () => 'नवा ऑर्डर आय, टेकअवे।',
      () => 'टेकअवे से ऑर्डर आय।',
      () => 'टेकअवे के ऑर्डर आय।',
    ],
  },
  mumbai: {
    table: [
      (t) => `टेबल नंबर ${t} पे नया ऑर्डर आ गया।`,
      (t) => `नया ऑर्डर आया, टेबल नंबर ${t}।`,
      (t) => `टेबल ${t} से ऑर्डर आ गया।`,
      (t) => `टेबल नंबर ${t} का ऑर्डर आ गया।`,
    ],
    takeaway: [
      () => 'टेकअवे पे नया ऑर्डर आ गया।',
      () => 'नया ऑर्डर आया, टेकअवे।',
      () => 'टेकअवे से ऑर्डर आ गया।',
      () => 'टेकअवे का ऑर्डर आ गया।',
    ],
  },
};

/** The four expressive variations: same facts, four ways a person says them. */
function dialectVariation(id: string, slot: number): PersonalityVariation {
  return {
    id,
    opener: (table, dialect) => {
      const openers = DIALECT_OPENERS[dialect ?? DEFAULT_DIALECT];
      if (isTakeaway(table)) return openers.takeaway[slot]();
      return openers.table[slot](spokenTable(table));
    },
    itemsIntro: () => '',
    itemsSeparator: () => ', ',
    closer: () => '',
  };
}

const VAR_ARRIVAL_1 = dialectVariation('arrival-1', 0);
const VAR_ARRIVAL_2 = dialectVariation('arrival-2', 1);
const VAR_ARRIVAL_3 = dialectVariation('arrival-3', 2);
const VAR_ARRIVAL_4 = dialectVariation('arrival-4', 3);

/**
 * Variation 5 -- Standard. "एक नया ऑर्डर आया है।" (order and note only).
 * The safety path has always used it: plain Hindi, no dialect, so an
 * allergy note is never framed in anything a stressed cook could mishear.
 */
const VAR_STANDARD: PersonalityVariation = {
  id: 'standard',
  opener: (table) =>
    isTakeaway(table)
      ? 'एक नया टेकअवे ऑर्डर आया है।'
      : `एक नया ऑर्डर आया है। टेबल नंबर ${spokenTable(table)}।`,
  itemsIntro: () => '',
  itemsSeparator: () => ', ',
  closer: () => '',
};

/** All variations, in rotation order. */
export const PERSONALITY_VARIATIONS: PersonalityVariation[] = [
  VAR_ARRIVAL_1,
  VAR_ARRIVAL_2,
  VAR_ARRIVAL_3,
  VAR_ARRIVAL_4,
  VAR_STANDARD,
];

/* ========================================================================== */
/*  Helper functions                                                          */
/* ========================================================================== */

/**
 * Normalize a guest note for speech.
 *
 * Strips trailing punctuation so the expressive label can provide its own.
 * Converts to Devanagari through the same path the plain announcement uses,
 * so a note is never pronounced differently by the expressive voice.
 */
function spokenNote(note: string | null | undefined): string {
  const trimmed = (note ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?।]+$/, '');
  if (!trimmed) return '';
  return noteToDevanagari(trimmed);
}

/**
 * Build the dish list for one variation.
 *
 * Uses spokenItem from announce.ts, so quantities, portions and add-ons are
 * spoken exactly as the plain announcement would. The list is joined the way
 * a person reads one aloud: commas between dishes, "और" before the last --
 * "दो पनीर टिक्का और एक बटर नान", not a flat comma run. That single "और"
 * gives the TTS engine a natural rising-falling list contour instead of the
 * monotone of items read as a shopping list.
 */
function spokenItems(
  items: SpeakableItem[],
  variation: PersonalityVariation,
): string {
  const parts = items.map(spokenItem);
  if (parts.length <= 1) return parts.join('');
  const head = parts.slice(0, -1).join(variation.itemsSeparator());
  return `${head} और ${parts[parts.length - 1]}`;
}

/* ========================================================================== */
/*  Main function                                                             */
/* ========================================================================== */

/**
 * Build an expressive kitchen announcement from order data.
 *
 * @param table      Table label (e.g. "5", "T12", "Takeaway").
 * @param items      Ordered dish list with quantities and details.
 * @param note       Guest note (e.g. "no onion"), or null/undefined.
 * @param variationIndex  Which personality variation to use. Defaults to 0.
 *                        Rotate this for consecutive announcements so the
 *                        voice does not sound like a loop.
 *
 * @returns A Devanagari string ready for a TTS engine.
 *
 * The returned text uses expressive punctuation -- exclamation marks for
 * energy, ellipses for natural pauses, dandas for clear statement ends. A
 * TTS engine reads these as pacing and emphasis cues.
 */
export function buildExpressiveAnnouncement(
  table: string,
  items: SpeakableItem[],
  note: string | null | undefined,
  variationIndex: number = 0,
  dialect?: AnnouncementDialect,
): string {
  const variation =
    PERSONALITY_VARIATIONS[variationIndex % PERSONALITY_VARIATIONS.length];

  const parts: string[] = [];

  // Opener: names the table and the new order.
  parts.push(variation.opener(table, dialect));

  // Dish list: every item, in order, with its quantity and detail.
  const itemsText = spokenItems(items, variation);
  if (itemsText) {
    const intro = variation.itemsIntro();
    parts.push(intro ? `${intro} ${itemsText}!` : `${itemsText}।`);
  }

  // Guest note: said directly, as the guest's own instruction -- "प्याज़ नहीं",
  // "तीखा बनाना". Never labelled ("नोट —", "ध्यान देना"): the label was the one
  // word that was neither the order nor the note, and the note is already
  // phrased as something a cook acts on.
  const noteText = spokenNote(note);
  if (noteText) {
    parts.push(`${noteText}।`);
  }

  // No closer. The order and the note are the whole announcement.
  const closer = variation.closer();
  if (closer) parts.push(closer);

  return parts.join(' ');
}

/**
 * Get the next variation index for rotation.
 *
 * Uses a module-level counter so consecutive calls naturally rotate through
 * all variations. Returns the index and advances the counter.
 *
 * In React, this is called during render. The counter advances on each call,
 * so the KitchenScreen can use it to vary announcements without tracking
 * state itself.
 */
let variationCounter = 0;

/**
 * Advance and return the next variation index.
 *
 * @param style  'expressive' for full personality, 'standard' for clear Hindi.
 * @returns The variation index to use.
 */
export function nextVariationIndex(style: AnnouncementStyle = 'expressive'): number {
  const index = variationCounter;
  variationCounter = (variationCounter + 1) % PERSONALITY_VARIATIONS.length;
  // For standard style, always return the standard variation index.
  if (style === 'standard') {
    const stdIndex = PERSONALITY_VARIATIONS.findIndex(
      (v) => v.id === 'standard',
    );
    return stdIndex >= 0 ? stdIndex : 0;
  }
  return index;
}

/** Reset the variation counter (for testing). */
export function resetVariationCounter(): void {
  variationCounter = 0;
}

/** Get the current variation counter value (for testing). */
export function getVariationCounter(): number {
  return variationCounter;
}

/* ========================================================================== */
/*  Pre-announcement: which style to use                                      */
/* ========================================================================== */

/**
 * Decide whether to use expressive or standard style for an announcement.
 *
 * The rule is simple: if the note is a safety-critical instruction -- an
 * allergy, a substitution, a dietary restriction -- use standard (clear)
 * Hindi. Slang around a safety instruction risks the instruction being
 * missed or misunderstood.
 *
 * Everything else -- a new order, an advance, a cancellation -- uses the
 * full expressive personality.
 *
 * @param note  The guest note, if any.
 * @returns 'expressive' or 'standard'.
 */
export function decideStyle(note: string | null | undefined): AnnouncementStyle {
  const trimmed = (note ?? '').trim().toLowerCase();
  if (!trimmed) return 'expressive';

  // Safety-critical keywords: anything that changes what goes in the dish
  // or what the kitchen must not do. These are stated plainly.
  const SAFETY_PATTERN =
    /(no|without|less|extra|allerg|gluten|lactose|vegan|vegetarian|halal|kosher|onion|garlic|cheese|dairy|nut|peanut|spice|medium|mild|hot|salad|sauce)/i;

  if (SAFETY_PATTERN.test(trimmed)) {
    return 'standard';
  }

  return 'expressive';
}

/* ========================================================================== */
/*  Convenience: build with automatic style decision                          */
/* ========================================================================== */

/**
 * Build an announcement with automatic style selection.
 *
 * Uses decideStyle() to choose expressive or standard based on the note.
 * Rotates variations automatically via nextVariationIndex().
 *
 * This is the function the KitchenScreen should call.
 */
export function buildKitchenAnnouncement(
  table: string,
  items: SpeakableItem[],
  note: string | null | undefined,
  dialect?: AnnouncementDialect,
): string {
  const style = decideStyle(note);
  const index = nextVariationIndex(style);
  return buildExpressiveAnnouncement(table, items, note, index, dialect);
}
