/**
 * The guest's note, said as an English instruction.
 *
 * WHY THIS FILE EXISTS
 *
 * The kitchen can now hear the pass in Hindi or English (the board's
 * announcement-language control). Hindi note rendering lives in hindi.ts and
 * is exact about verb classes; this is its English twin. Both take what a
 * guest typed and return what a cook is told to DO -- never a transliteration,
 * never a label.
 *
 * THE INSTRUCTION, NOT THE WORDS
 *
 * Same contract as the Hindi side (PRs #130-#131), in English imperatives:
 *
 *   · "extra spicy"  -> "make extra spicy"    (a quality is MADE)
 *   · "less spicy"   -> "less spicy"          (a reduction says itself)
 *   · "extra butter" -> "add extra butter"    (things that go IN are ADDED)
 *   · "extra roti"   -> "serve extra roti"    (things on the plate are SERVED)
 *   · "no onion"     -> "no onion"            (a negation is already an order)
 *
 * Anything that matches no pattern is left exactly as the guest wrote it --
 * an honest fallback beats a mangled guess.
 */

/** How the dish should come OUT -- made, never added. Exported for the item clause in announce.ts, which sorts add-ons the same way. */
export const QUALITY_WORDS: ReadonlySet<string> = new Set([
  'spicy', 'crispy', 'crunchy', 'hot', 'warm', 'sweet', 'salty', 'soft', 'fresh',
]);

/**
 * Things that arrive on the plate -- "serve", never "add": "extra roti" is
 * served, "extra butter" is added to the dish.
 */
const SERVE: ReadonlySet<string> = new Set([
  'roti', 'naan', 'rice', 'biryani', 'pulao', 'paratha', 'kulcha', 'puri', 'dosa',
  'idli', 'thali', 'dal', 'daal', 'sabzi', 'soup', 'salad', 'raita', 'papad',
  'water', 'lassi', 'chai', 'tea', 'coffee', 'juice', 'plate', 'glass', 'napkin',
  'tissue', 'spoon', 'fork', 'curd', 'cake', 'dessert',
]);

/**
 * One note, as an English instruction.
 *
 * Sentence case is the guest's own -- "Make extra spicy" comes from "extra
 * spicy" starting a note. A trailing full stop is stripped first so a note
 * that ends in one does not end in two.
 */
export function noteToEnglish(text: string): string {
  let out = text
    // Courtesies are not part of the instruction.
    .replace(/\b(?:please|pls|plz|kindly|thank you|thanks|thx)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '');

  if (!out) return '';

  // "make it extra spicy" already says the verb -- strip the framing verb so
  // the rules below rebuild one instruction shape for every input.
  out = out.replace(/\bmake(?:\s+it)?\b/gi, '');

  // One pass, so a rebuilt instruction is never rewritten again: the verb
  // depends on what the word is -- a quality is made, a thing is added or
  // served, and a reduction mostly says itself.
  out = out.replace(
    /\b(?:(more|extra|less)\s+)?([a-z]+)\b/gi,
    (whole, qty: string | undefined, word: string) => {
      const lower = word.toLowerCase();
      const q = qty?.toLowerCase();
      if (QUALITY_WORDS.has(lower)) {
        // "extra spicy" -> "make extra spicy"; "less spicy" -> "less spicy";
        // "spicy" alone -> "make it spicy".
        if (q === 'less') return `less ${word}`;
        return q ? `make ${q} ${word}` : `make it ${word}`;
      }
      if (!q) return whole;
      if (q === 'less') return SERVE.has(lower) ? `serve less ${word}` : `add less ${word}`;
      return SERVE.has(lower) ? `serve ${q} ${word}` : `add ${q} ${word}`;
    },
  );

  out = out.replace(/\s+/g, ' ').trim();

  // Sentence case: the note is said as one instruction.
  return out.charAt(0).toUpperCase() + out.slice(1);
}
