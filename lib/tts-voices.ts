/**
 * Edge TTS voice catalogue and prosody helpers.
 *
 * This module has NO browser dependencies. It can be imported by both the
 * server API route (app/api/tts) and the client-side server speech engine
 * (lib/server-speech.ts). Keeping the catalogue in one place means the
 * API route and the client engine always agree on which voices exist.
 */

/** An Edge TTS Hindi voice. */
export type EdgeVoice = {
  /** Full Edge TTS voice name, e.g. "hi-IN-MadhurNeural". */
  name: string;
  /** BCP-47 locale, e.g. "hi-IN". */
  lang: string;
  /** Gender as reported by the Edge TTS voice list. */
  gender: 'Male' | 'Female';
};

/**
 * Hindi male Edge TTS voices, in order of preference for the kitchen
 * character: deep, warm, mature, conversational.
 *
 * - Madhur: the standard male Hindi neural voice. Friendly, positive,
 *   mature. The best baseline for a warm, confident delivery.
 * - Aarav: newer male voice. More expressive, conversational.
 * - Kunal: newer male voice. Calm, measured, confident.
 * - Rehaan: newer male voice. Professional, clear, slightly formal.
 *
 * These are the male voices Microsoft ships for hi-IN as of late 2024.
 * The list is fixed because it is the server's voice catalogue — the
 * browser engine's voice list varies by device, but the server engine's
 * list is the same everywhere.
 */
export const EDGE_HINDI_VOICES: readonly EdgeVoice[] = [
  { name: 'hi-IN-MadhurNeural', lang: 'hi-IN', gender: 'Male' },
  { name: 'hi-IN-AaravNeural', lang: 'hi-IN', gender: 'Male' },
  { name: 'hi-IN-KunalNeural', lang: 'hi-IN', gender: 'Male' },
  { name: 'hi-IN-RehaanNeural', lang: 'hi-IN', gender: 'Male' },
];

/** Default voice: Madhur is the deepest, warmest male Hindi voice. */
export const DEFAULT_EDGE_VOICE = 'hi-IN-MadhurNeural';

/**
 * Default pitch: -20Hz for a deeper, warmer, more mature male character.
 *
 * Changed from -10Hz to -20Hz to achieve a deeper, more Jackie Shroff-style
 * baritone delivery. The -10Hz value was too subtle — the voice still sounded
 * close to the default Madhur voice. -20Hz produces a noticeably deeper,
 * more authoritative tone while staying within Edge TTS's comfortable range.
 */
export const DEFAULT_PITCH = '-20Hz';

/** Default volume: normal. */
export const DEFAULT_VOLUME = '+0.00%';

/**
 * Convert a browser-style rate multiplier to an Edge TTS prosody string.
 *
 * The browser Web Speech API uses a multiplier where 1.0 is normal speed.
 * Edge TTS uses a percentage change from the voice's default rate.
 *
 * THE FORMAT IS INTEGERS ONLY — this is not a style choice. edge-tts-universal
 * validates prosody before sending it (`/^[+-]\d+%$/` for rate and volume,
 * `/^[+-]\d+Hz$/` for pitch) and throws `Invalid rate '+0.00%'` on anything
 * with a decimal point. An earlier version of this function returned
 * "+0.00%"-style strings; every /api/tts call died in that validator, the
 * kitchen fell back to the browser's (often female) Hindi voice, and the
 * failure looked like "Edge TTS is blocked" instead of "the numbers were
 * formatted wrong". Keep the integer shape; the tests enforce it against
 * the library's own validator.
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
 * format edge-tts-universal accepts.
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
 * Coerce a caller-supplied pitch to the integer-Hz format
 * edge-tts-universal accepts (`[+-]\d+Hz`). Same tolerance rules as
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
