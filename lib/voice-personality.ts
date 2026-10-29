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
 * SLANG AND CLARITY
 *
 * SENSE COMES FIRST. Every sentence must carry real information (what
 * arrived, where, what to cook) or a real instruction (start now, keep
 * this in mind, make it exactly like the note says). Filler like
 * "please make it carefully" says nothing -- it is the kind of line that
 * makes a voice sound robotic however good the engine is. The warmth
 * lives in HOW things are said: Nagpuri vocatives ("गुरु", "मान"),
 * interjections ("अरे माय रे!"), and the natural shapes of real speech --
 * short clauses, an "और" before the last dish, a closing question --
 * which give the TTS engine rising-falling, conversational prosody.
 *
 * The slang is pure Nagpuri -- the kitchen talk of the Nagpur-Vidarbha
 * belt ("अरे माय रे गुरु!", "सुन ना गुरु!", "मान", "का माँगा है") --
 * written in Devanagari so the TTS reads them as Hindi. When a note is a
 * safety instruction -- an allergy, a substitution -- it is stated
 * plainly, with no slang or joke that could blur the instruction. Both
 * the male (Madhur) and female (Swara) characters speak this same text
 * -- the personality is in the words, not the voice model, so both
 * voices carry the same Nagpuri slang.
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
 * dishes, how it labels the note, and how it closes. The dynamic data -- table,
 * items, note -- is injected by the variation's functions, so the variation
 * only controls the expressive wording around it.
 */
export type PersonalityVariation = {
  /** Stable identifier, used for testing and debugging. */
  id: string;
  /** The opening line, including the table if there is one. */
  opener: (table: string) => string;
  /** A short transition before the dish list. */
  itemsIntro: () => string;
  /** Separator between dish phrases. */
  itemsSeparator: () => string;
  /** Label that introduces the guest note. */
  noteLabel: () => string;
  /** The closing line. */
  closer: () => string;
};

/** The style of announcement to generate. */
export type AnnouncementStyle = 'expressive' | 'standard';

/* ========================================================================== */
/*  Variations                                                                */
/* ========================================================================== */

/**
 * Variation 1 -- Arey Maay Re Guru.
 *
 * The warm showman, in full Vidarbha exclamation. "अरे माय रे गुरु!" is
 * the Nagpuri "oh my god, buddy". Every line after it earns its place:
 * where the order is from, what to cook, the guest's constraint, and the
 * one fact that drives the kitchen -- the guests are already hungry, so
 * start now.
 */
const VAR_AREY_MAMA: PersonalityVariation = {
  id: 'arey-mama',
  opener: (table) =>
    isTakeaway(table)
      ? 'अरे माय रे गुरु! टेकअवे का नया ऑर्डर आया है!'
      : `अरे माय रे गुरु! टेबल नंबर ${spokenTable(table)} से नया ऑर्डर आया है!`,
  itemsIntro: () => 'ये बनाना है —',
  itemsSeparator: () => ', ',
  noteLabel: () => 'और सुनों गुरु, ये ज़रूरी बात है —',
  closer: () => 'मान, मेहमान भूखे बैठे हैं — अभी शुरू कर दे!',
};

/**
 * Variation 2 -- Sunn Na Guru.
 *
 * Quick and conversational. "का माँगा है" is the Nagpuri "kya maanga
 * hai" ("what did they ask for"), and the closer ends on a real
 * question -- "ठीक है?" -- because a question is what makes a voice
 * sound like a person talking to people, not a system reading a ticket.
 */
const VAR_SUNO_RE: PersonalityVariation = {
  id: 'suno-re',
  opener: (table) =>
    isTakeaway(table)
      ? 'सुन ना गुरु! टेकअवे का नया ऑर्डर आ गया!'
      : `सुन ना गुरु! टेबल ${spokenTable(table)} से नया ऑर्डर आ गया!`,
  itemsIntro: () => 'देख ले, का माँगा है इन्होंने —',
  itemsSeparator: () => ', ',
  noteLabel: () => 'और हाँ गुरु, ये बात ध्यान में रखना —',
  closer: () => 'गुरु, मेहमान इंतज़ार कर रहे हैं — जल्दी शुरू करो, ठीक है?',
};

/**
 * Variation 3 -- Dhyaan De Guru.
 *
 * The clear commander. The order is a "farmaan", the instruction is
 * "hukm saaf", and the closer says the only thing that matters at that
 * moment -- hunger waits for no one, so move, fatafat. Direct and
 * sensible: nothing in it is decoration.
 */
const VAR_DHYaan_DENA: PersonalityVariation = {
  id: 'dhyaan-dena',
  opener: (table) =>
    isTakeaway(table)
      ? 'ध्यान दे गुरु! टेकअवे से नया फरमान आया है!'
      : `ध्यान दे गुरु! टेबल नंबर ${spokenTable(table)} से नया फरमान आया है!`,
  itemsIntro: () => 'हुक्म साफ़ है, ये बनाना है —',
  itemsSeparator: () => ', ',
  noteLabel: () => 'और सुनों, ये ज़रूरी है —',
  closer: () => 'भूख किसी का इंतज़ार नहीं करती — फटाफट चलो!',
};

/**
 * Variation 4 -- Arey Baap Re Guru.
 *
 * The friendly one. "अरे बाप रे गुरु!" for the arrival, "sunn sunn, ye
 * chahiye inko" like a friend passing on the order, and the closer is a
 * real goal the cook can act on: make it so good the guest comes back.
 */
const VAR_AREY_BHAI: PersonalityVariation = {
  id: 'arey-bhai',
  opener: (table) =>
    isTakeaway(table)
      ? 'अरे बाप रे गुरु! टेकअवे का नया ऑर्डर आ गया!'
      : `अरे बाप रे गुरु! टेबल ${spokenTable(table)} का नया ऑर्डर आ गया!`,
  itemsIntro: () => 'सुन सुन, ये चाहिए इनको —',
  itemsSeparator: () => ', ',
  noteLabel: () => 'और हाँ, ये वाली बात —',
  closer: () => 'मान, ऐसा बनाना कि मेहमान दोबारा आए!',
};

/**
 * Variation 5 -- Standard.
 *
 * No slang. Used when the note is a safety instruction and needs maximum
 * clarity. Plain clear Hindi, every word functional: what arrived, where,
 * what to cook, the constraint, and the one instruction that follows from
 * it -- make it exactly like the note says. No filler pleasantry at the
 * end; "please make it carefully" is the kind of empty line that sounds
 * robotic and says nothing a cook can act on.
 */
const VAR_STANDARD: PersonalityVariation = {
  id: 'standard',
  opener: (table) =>
    isTakeaway(table)
      ? 'एक नया टेकअवे ऑर्डर आया है।'
      : `एक नया ऑर्डर आया है। टेबल नंबर ${spokenTable(table)}।`,
  itemsIntro: () => '',
  itemsSeparator: () => ', ',
  noteLabel: () => 'ये ज़रूरी निर्देश है —',
  closer: () => 'ऐसा ही बनाना है।',
};

/** All variations, in rotation order. */
export const PERSONALITY_VARIATIONS: PersonalityVariation[] = [
  VAR_AREY_MAMA,
  VAR_SUNO_RE,
  VAR_DHYaan_DENA,
  VAR_AREY_BHAI,
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
): string {
  const variation =
    PERSONALITY_VARIATIONS[variationIndex % PERSONALITY_VARIATIONS.length];

  const parts: string[] = [];

  // Opener: names the table and the new order.
  parts.push(variation.opener(table));

  // Dish list: every item, in order, with its quantity and detail.
  const itemsText = spokenItems(items, variation);
  if (itemsText) {
    const intro = variation.itemsIntro();
    parts.push(intro ? `${intro} ${itemsText}!` : `${itemsText}।`);
  }

  // Guest note: last and labelled, because it is a constraint, not a dish.
  const noteText = spokenNote(note);
  if (noteText) {
    const label = variation.noteLabel();
    // For the standard variation, the label already ends with a comma.
    parts.push(
      label ? `${label} ${noteText}।` : `${noteText}।`,
    );
  }

  // Closer: the human "get it done" line.
  parts.push(variation.closer());

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
): string {
  const style = decideStyle(note);
  const index = nextVariationIndex(style);
  return buildExpressiveAnnouncement(table, items, note, index);
}
