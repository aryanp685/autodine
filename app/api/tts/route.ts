/**
 * Server-side Hindi TTS relay.
 *
 * WHY THIS ROUTE EXISTS
 *
 * The kitchen voice was previously limited to whatever Hindi voice the
 * browser happened to have installed. On a cheap Android tablet that is
 * often an espeak-ng voice reading Devanagari at an English phoneme set —
 * which produces noise while reporting success. On a device with a good
 * voice, the quality is still whatever Microsoft or Google shipped with
 * the OS, with no control over character or warmth.
 *
 * Edge TTS is a free, key-less Microsoft service that exposes Azure-grade
 * neural Hindi voices. It cannot be called directly from Chrome or Firefox
 * (the WebSocket handshake requires a header browsers do not allow setting),
 * so the browser must relay through this route. The route runs on the
 * server, where the full WebSocket header set is available.
 *
 * WHAT THIS ROUTE DOES NOT DO
 *
 * It does not store text, does not log announcements, does not accept
 * credentials, and does not fall back to English. It is a pass-through
 * from a Hindi sentence to a Hindi MP3. If Edge TTS is unreachable the
 * route returns 503 and the kitchen falls back to the browser Web Speech
 * API — the existing engine, unchanged.
 *
 * LICENCE
 *
 * Edge TTS is a community-reverse-engineered interface to Microsoft's
 * Read Aloud feature. It is free and requires no API key. Microsoft has
 * not published a support commitment for it. This route is the pragmatic
 * choice at ₹0/month; the alternative (Azure Speech Studio) costs money
 * and was ruled out by the standing no-paid-services constraint.
 */

import { EdgeTTS } from 'edge-tts-universal';

/** The runtime must be Node.js: the WebSocket client needs `ws`. */
export const runtime = 'nodejs';

/** Edge runtime has no WebSocket support — this route requires Node. */
export const maxDuration = 30;

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
 * These are the voices Microsoft ships for hi-IN. The list is fixed
 * because it is the server's voice catalogue — the browser engine's
 * voice list varies by device, but the server engine's list is the
 * same everywhere.
 */
export const EDGE_HINDI_VOICES = [
  { name: 'hi-IN-MadhurNeural', lang: 'hi-IN', gender: 'Male' as const },
  { name: 'hi-IN-AaravNeural', lang: 'hi-IN', gender: 'Male' as const },
  { name: 'hi-IN-KunalNeural', lang: 'hi-IN', gender: 'Male' as const },
  { name: 'hi-IN-RehaanNeural', lang: 'hi-IN', gender: 'Male' as const },
];

/** Default voice: Madhur is the deepest, warmest male Hindi voice. */
export const DEFAULT_EDGE_VOICE = 'hi-IN-MadhurNeural';

/** Prosody defaults for the kitchen character. */
const DEFAULT_PROSODY = {
  /** Rate: converted from the browser engine's multiplier by the caller. */
  rate: '+0.00%',
  /** Pitch: -10Hz for a deeper, warmer, more mature character. */
  pitch: '-10Hz',
  /** Volume: normal. */
  volume: '+0.00%',
};

/** Body schema: text is required, voice/rate/pitch are optional. */
type TTSRequest = {
  text: string;
  voice?: string;
  rate?: string;
  pitch?: string;
};

/**
 * POST /api/tts
 *
 * Synthesizes Hindi text to MP3 audio. The browser sends a sentence and
 * receives an audio/mpeg response. One sentence per call — the kitchen
 * engine paces sentences client-side and fetches each one separately.
 */
export async function POST(request: Request): Promise<Response> {
  let body: TTSRequest;
  try {
    body = await request.json() as TTSRequest;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: 'Missing text' }, { status: 400 });
  }

  // Validate voice against the known catalogue. An unknown voice means a
  // stale preference from another deployment — fall back to the default
  // rather than sending a bad voice name to Edge TTS.
  const voice = body.voice && EDGE_HINDI_VOICES.some(v => v.name === body.voice)
    ? body.voice
    : DEFAULT_EDGE_VOICE;

  const prosody = {
    rate: body.rate ?? DEFAULT_PROSODY.rate,
    pitch: body.pitch ?? DEFAULT_PROSODY.pitch,
    volume: DEFAULT_PROSODY.volume,
  };

  try {
    const tts = new EdgeTTS(text, voice, prosody);
    const result = await tts.synthesize();

    // The audio field is a Blob containing MP3 data. Return it directly
    // with the correct content type. Node 18+ Response accepts Blob.
    return new Response(result.audio as unknown as Blob, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    // Edge TTS may be unreachable (network, service change, etc.). The
    // kitchen engine treats a 503 as "server speech failed" and falls
    // back to the browser Web Speech API. No stack trace is sent to
    // the client — the reason stays in the server logs.
    const message = error instanceof Error ? error.message : 'TTS synthesis failed';
    console.error('[tts] Edge TTS synthesis failed:', message);
    return Response.json(
      { error: 'TTS service unavailable' },
      { status: 503 },
    );
  }
}
