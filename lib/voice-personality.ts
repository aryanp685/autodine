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
 * The slang is Nagpuri-Mumbai kitchen talk ("arey mama", "suno re bhai",
 * "arey baapre", "patkan") -- the words a real kitchen in that belt uses,
 * written in Devanagari so the TTS reads them as Hindi. The jokes are the
 * jokes a kitchen actually makes: the guests are already hungry, the order
 * is a farmaan, hunger waits for no one, cook it so well the guest says
 * "waah bhai waah". Regional expressions ("re", "haan", "bhai", "mama",
 * "patkan") are used naturally, not forced into every sentence. When a
 * note is a safety instruction -- an allergy, a substitution -- it is
 * stated plainly, with no slang or joke that could blur the instruction.
 * Humour wraps the order; it never replaces it. Both the male (Madhur)
 * and female (Swara) characters speak this same text -- the personality
 * is in the words, not the voice model.
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
 * Variation 1 -- Arey Mama.
 *
 * The showman. "Arey mama!" plus the joke that the guests are already
 * sitting hungry -- urgency with a smile. The dish list is the mehmaan's
 * "farmaaish" (their royal request), and the closer hands the chef the
 * one compliment a cook can never resist: show the magic of your hands.
 */
const VAR_AREY_MAMA: PersonalityVariation = {
  id: 'arey-mama',
  opener: (table) =>
    isTakeaway(table)
      ? 'अरेय्यो माम! टेकअवे का नया ऑर्डर आया है रे! मेहमान भूखे बैठे हैं!'
      : `अरेय्यो माम! नया ऑर्डर आया है रे! टेबल नंबर ${spokenTable(table)}, मेहमान भूखे बैठे हैं!`,
  itemsIntro: () => 'ये रही फरमाइश!',
  itemsSeparator: () => ', ',
  noteLabel: () => 'और सुनों माम, एक ज़रूरी बात…',
  closer: () => 'भाई, अपने हाथ का जादू दिखाओ!',
};

/**
 * Variation 2 -- Suno Re Bhai.
 *
 * Nagpuri energy with a rhyme that sticks: "patkan banao aur kamaal
 * dikhaao" -- make it quick and show the magic. The dish list is framed
 * as "look what they asked for", and the note gets a plain, unmistakable
 * "this is important".
 */
const VAR_SUNO_RE: PersonalityVariation = {
  id: 'suno-re',
  opener: (table) =>
    isTakeaway(table)
      ? 'सुनो रे भाई! टेकअवे का नया ऑर्डर आ गया!'
      : `सुनो रे भाई! टेबल ${spokenTable(table)} का नया ऑर्डर आ गया!`,
  itemsIntro: () => 'देखो ज़रा, क्या माँगा है!',
  itemsSeparator: () => ', ',
  noteLabel: () => 'और हैन्, ये ज़रूरी है…',
  closer: () => 'पटकन बनाओ और कमाल दिखाओ!',
};

/**
 * Variation 3 -- Dhyaan Dena.
 *
 * The royal decree. The order is a "farmaan" from the table, the dish
 * list is "the order is clear", and the closer delivers the line every
 * kitchen lives by: hunger waits for no one. Confident, commanding, and
 * funny because it is true.
 */
const VAR_DHYaan_DENA: PersonalityVariation = {
  id: 'dhyaan-dena',
  opener: (table) =>
    isTakeaway(table)
      ? 'ध्यान देना भाई! टेकअवे से नया फरमान आया है!'
      : `ध्यान देना भाई! टेबल नंबर ${spokenTable(table)} से नया फरमान आया है!`,
  itemsIntro: () => 'हुक्म साफ़ है!',
  itemsSeparator: () => ', ',
  noteLabel: () => 'और सुनों…',
  closer: () => 'भूख किसी का इंतज़ार नहीं करती, जल्दी चलो!',
};

/**
 * Variation 4 -- Arey Bhai.
 *
 * Mumbai cool. "Arey baapre!" for the arrival, "suno suno, ye chahiye
 * inko" like a friend passing on gossip, and the closer is the dream:
 * cook it so well the guest says "waah bhai waah". The note stays plain
 * after the label -- the wish never touches the instruction.
 */
const VAR_AREY_BHAI: PersonalityVariation = {
  id: 'arey-bhai',
  opener: (table) =>
    isTakeaway(table)
      ? 'अरे बापरे! टेकअवे ऑर्डर आ गया!'
      : `अरे बापरे! टेबल ${spokenTable(table)} का ऑर्डर आ गया!`,
  itemsIntro: () => 'सुनो सुनो, ये चाहिए इनको…',
  itemsSeparator: () => ', ',
  noteLabel: () => 'और हैन्…',
  closer: () => 'ऐसा बनाओ कि मेहमान बोले, वाह भाई वाह!',
};

/**
 * Variation 5 -- Standard.
 *
 * No slang. Used when the note is a safety instruction and needs maximum
 * clarity. Plain clear Hindi -- but still warm: the closer asks nicely
 * instead of announcing like a robot.
 */
const VAR_STANDARD: PersonalityVariation = {
  id: 'standard',
  opener: (table) =>
    isTakeaway(table)
      ? 'एक नया टेकअवे ऑर्डर आया है।'
      : `एक नया ऑर्डर आया है। टेबल नंबर ${spokenTable(table)}।`,
  itemsIntro: () => '',
  itemsSeparator: () => ', ',
  noteLabel: () => 'ध्यान दें,',
  closer: () => 'कृपया ध्यान से बनाइए।',
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
 * spoken exactly as the plain announcement would. The variation only controls
 * the separator between dishes, not the dish text itself.
 */
function spokenItems(
  items: SpeakableItem[],
  variation: PersonalityVariation,
): string {
  return items.map(spokenItem).join(variation.itemsSeparator());
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
