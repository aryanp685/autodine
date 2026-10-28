/**
 * Edge TTS voice catalogue and prosody helpers.
 *
 * This module has NO browser dependencies. It can be imported by both the
 * server API route (app/api/tts) and the client-side server speech engine
 * (lib/server-speech.ts). Keeping the catalogue in one place means the
 * API route and the client engine always agree on which voices exist.
 */

/** The gender of a voice character. */
export type Gender = 'Male' | 'Female';

/** An Edge TTS Hindi voice. */
export type EdgeVoice = {
  /** Full Edge TTS voice name, e.g. "hi-IN-MadhurNeural". */
  name: string;
  /** BCP-47 locale, e.g. "hi-IN". */
  lang: string;
  /** Gender as reported by the Edge TTS voice list. */
  gender: Gender;
  /** SSML pitch applied when the caller sends no explicit pitch. */
  pitch: string;
  /** Human label for the kitchen picker, Hindi name plus gender. */
  label: string;
};

/**
 * The kitchen voice catalogue: ONE male, ONE female.
 *
 * That is not a restriction invented here — it is the complete Hindi
 * offering of the Microsoft Read Aloud service (verified against its live
 * voice list): exactly two hi-IN voices, both GA, both tagged
 * "Friendly, Positive" (conversational, not news-reader).
 *
 * - Madhur (male): warm, mature, friendly. The kitchen's default character.
 * - Swara (female): friendly, positive, clear.
 *
 * An earlier catalogue listed Aarav/Kunal/Rehaan from Azure's broader
 * voice list; the Read Aloud endpoint does not serve them, so selecting one
 * could never produce audio. Only voices this service actually serves may
 * appear here.
 *
 * The Nagpuri/Mumbai slang lives in the words (lib/voice-personality.ts),
 * not in these models — both characters speak the same desi text; their
 * naturalness comes from neural delivery plus expressive punctuation.
 */
export const EDGE_HINDI_VOICES: readonly EdgeVoice[] = [
  {
    name: 'hi-IN-MadhurNeural',
    lang: 'hi-IN',
    gender: 'Male',
    // Barely-there warmth. The old -20Hz baritone was a style choice that
    // pushed the model out of its natural range; "natural human tone" means
    // staying close to the voice's own pitch.
    pitch: '-4Hz',
    label: 'माधुर (पुरुष)',
  },
  {
    name: 'hi-IN-SwaraNeural',
    lang: 'hi-IN',
    gender: 'Female',
    pitch: '+0Hz',
    label: 'स्वरा (स्त्री)',
  },
];

/** Default voice: Madhur, the warm male character. */
export const DEFAULT_EDGE_VOICE = 'hi-IN-MadhurNeural';

/**
 * Default pitch: the default voice's natural pitch (see the catalogue).
 */
export const DEFAULT_PITCH = '-4Hz';

/** Default volume: normal. */
export const DEFAULT_VOLUME = '+0%';

/**
 * The SSML pitch for a catalogue voice, or the default when unknown.
 * The route and the server engine use this so a voice never inherits
 * another voice's character (Swara at -4Hz would sound artificially deep).
 */
export function defaultPitchFor(name: string): string {
  return findEdgeVoice(name)?.pitch ?? DEFAULT_PITCH;
}

/**
 * Voice-name gender inference.
 *
 * The Web Speech API does not expose gender, so the browser fallback engine
 * infers it from names to match the character the operator picked (male
 * Madhur or female Swara). Catalogue names resolve exactly; device names
 * fall back to common Hindi voice-name hints. Unknown names return null —
 * neither penalised nor preferred on gender alone.
 */

/** Voice-name substrings that indicate a female Hindi voice. */
const FEMALE_VOICE_HINTS = /(swara|lekha|kalpana|heera|aditi|veena|neerja|priya|anjali|meera|sneha|kavita|sunita|radha|sita|durga|tara|gita|usha|vijaya|reetha|madhuri|sridevi|hema|rekha|sakshi|tanvi|irisha|female|woman)/i;

/** Voice-name substrings that indicate a male Hindi voice. */
const MALE_VOICE_HINTS = /(ravi|prabhat|madhur|suresh|aarav|kunal|rehaan|vikram|arjun|ramesh|mahesh|deepak|rajesh|kamal|nimesh|pradeep|manish|vivek|sanjay|rahul|hemant|male|man\b)/i;

/** The gender of a voice by name — catalogue first, then name hints. */
export function voiceGender(name: string): Gender | null {
  const edge = findEdgeVoice(name);
  if (edge) return edge.gender;
  if (FEMALE_VOICE_HINTS.test(name)) return 'Female';
  if (MALE_VOICE_HINTS.test(name)) return 'Male';
  return null;
}

/**
 * Human label for the kitchen picker: the catalogue's Hindi label for our
 * two characters, or the raw name for a device voice.
 */
export function voiceLabel(name: string): string {
  return findEdgeVoice(name)?.label ?? name;
}

/**
 * Convert a browser-style rate multiplier to an Edge TTS prosody string.
 *
 * The browser Web Speech API uses a multiplier where 1.0 is normal speed.
 * Edge TTS SSML uses a percentage change from the voice's default rate.
 *
 * THE FORMAT IS INTEGERS ONLY — a hard-won rule. The /api/tts wire format
 * is `[+-]\d+%` (rate/volume) and `[+-]\d+Hz` (pitch), matching SSML
 * relative prosody. An earlier version of this function returned
 * "+0.00%"-style strings, which the then-library rejected with
 * `Invalid rate '+0.00%'` before any network I/O: every /api/tts call
 * failed, the kitchen fell back to the browser's (often female) Hindi
 * voice, and the failure looked like "Edge TTS is blocked" instead of
 * "the numbers were formatted wrong". Keep the integer shape; the tests
 * enforce it.
 *
 *   rate 1.0   → "+0%"
 *   rate 0.92  → "-8%"
 *   rate 1.1   → "+10%"
 *   rate 0.9016→ "-10%"  (rounded)
 */
export function rateToProsody(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/** How far a percent prosody (rate, volume) may stray from normal. */
const PERCENT_CLAMP = 100;

/** How far a pitch may stray from the voice's default, in Hz. */
const PITCH_CLAMP = 100;

/**
 * Coerce a caller-supplied percent prosody (rate/volume) to the integer
 * format the /api/tts wire contract accepts.
 *
 * Tolerant on input ("+0.00%", "-8%", "12%", 12) and strict on output
 * (always `[+-]\d+%`). Anything unparseable falls back rather than throws —
 * a stale preference from an older deployment must not silence the kitchen.
 */
export function normalizeProsodyPercent(value: unknown, fallback: string): string {
  const match = typeof value === 'string'
    ? /^([+-]?\d+(?:\.\d+)?)\s*%?$/.exec(value.trim())
    : typeof value === 'number' && Number.isFinite(value)
      ? /^([+-]?\d+(?:\.\d+)?)$/.exec(String(value))
      : null;
  if (!match) return fallback;
  const pct = Math.round(Math.min(PERCENT_CLAMP, Math.max(-PERCENT_CLAMP, Number(match[1]))));
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/**
 * Coerce a caller-supplied pitch to the integer-Hz format the /api/tts wire
 * contract accepts (`[+-]\d+Hz`). Same tolerance rules as
 * normalizeProsodyPercent.
 */
export function normalizeProsodyHz(value: unknown, fallback: string): string {
  const match = typeof value === 'string'
    ? /^([+-]?\d+(?:\.\d+)?)\s*(?:Hz)?$/i.exec(value.trim())
    : typeof value === 'number' && Number.isFinite(value)
      ? /^([+-]?\d+(?:\.\d+)?)$/.exec(String(value))
      : null;
  if (!match) return fallback;
  const hz = Math.round(Math.min(PITCH_CLAMP, Math.max(-PITCH_CLAMP, Number(match[1]))));
  return `${hz >= 0 ? '+' : ''}${hz}Hz`;
}

/**
 * Escape text for inclusion inside an SSML document.
 *
 * Announcement text carries dish names ("Fish & Chips", "Dal <special>")
 * and msedge-tts inserts input into its SSML template verbatim — an
 * unescaped `&` or `<` is malformed XML and the synthesis request is
 * rejected. Five entities, in the order that keeps `&` from double-escaping.
 */
export function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Find an Edge TTS voice by name, or null if not in the catalogue. */
export function findEdgeVoice(name: string): EdgeVoice | null {
  return EDGE_HINDI_VOICES.find((v) => v.name === name) ?? null;
}

/** Convert an EdgeVoice to the VoiceLike shape used by SpeechEngine. */
export function toVoiceLike(voice: EdgeVoice): {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
} {
  return {
    name: voice.name,
    lang: voice.lang,
    localService: false, // server-side, not local to the device
    default: false,
  };
}
