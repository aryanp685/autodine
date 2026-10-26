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

/** Default pitch: -10Hz for a deeper, warmer, more mature character. */
export const DEFAULT_PITCH = '-10Hz';

/** Default volume: normal. */
export const DEFAULT_VOLUME = '+0.00%';

/**
 * Convert a browser-style rate multiplier to an Edge TTS prosody string.
 *
 * The browser Web Speech API uses a multiplier where 1.0 is normal speed.
 * Edge TTS uses a percentage change from the voice's default rate, e.g.
 * "+10.00%" or "-20.00%".
 *
 *   rate 1.0  → "+0.00%"
 *   rate 0.92 → "-8.00%"
 *   rate 1.1  → "+10.00%"
 */
export function rateToProsody(rate: number): string {
  const pct = (rate - 1) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
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
