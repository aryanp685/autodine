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
 * The service is Microsoft's Read Aloud API — a community-reverse-
 * engineered interface, free and key-less, with no published support
 * commitment (its handshake has broken before: the Sec-MS-GEC token moved
 * to a custom hash in 2026 and every stale client got 403). The client is
 * msedge-tts (MIT), which carries the current token and propagates
 * connection failures instead of hanging. This route is the pragmatic
 * choice at ₹0/month; the alternative (Azure Speech Studio) costs money
 * and was ruled out by the standing no-paid-services constraint. If
 * Microsoft breaks the interface again, this route answers 503 honestly,
 * the kitchen falls back to the browser voice, and scripts/tts-smoke.ts
 * says which layer failed.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import {
  DEFAULT_EDGE_VOICE,
  EDGE_HINDI_VOICES,
  defaultPitchFor,
  escapeSsml,
  normalizeProsodyHz,
  normalizeProsodyPercent,
} from '@/lib/tts-voices';

/** The runtime must be Node.js: the WebSocket client needs `ws`. */
export const runtime = 'nodejs';

/** Edge runtime has no WebSocket support — this route requires Node. */
export const maxDuration = 30;

/**
 * The kitchen's voice catalogue and default character live in
 * lib/tts-voices.ts so the client engine and this route can never drift
 * apart. Re-exported here because this route documents the catalogue as
 * part of its contract.
 */
export { EDGE_HINDI_VOICES, DEFAULT_EDGE_VOICE };

/**
 * Prosody defaults for the kitchen character.
 *
 * The wire format is integer SSML prosody ("+0%", not "+0.00%") — kept
 * strict after a decimal-format bug made every /api/tts call fail. The
 * inputs from the body are run through the same normalizers, so a stale
 * client bundle that still sends decimals gets coerced instead of failing.
 * Pitch has no single default: each voice carries its own natural pitch
 * (defaultPitchFor), so Swara never inherits Madhur's warmth.
 */
const DEFAULT_PROSODY = {
  /** Rate: converted from the browser engine's multiplier by the caller. */
  rate: '+0%',
  /** Volume: normal. */
  volume: '+0%',
};

/**
 * How long synthesis may run before this route gives up and answers 503.
 *
 * The WebSocket connect plus synthesis normally finishes in a couple of
 * seconds; without a ceiling a hung connection would hold the function open
 * until maxDuration and leave the kitchen staring at silence. 20s sits
 * under maxDuration and above any plausible cold start.
 */
const SYNTHESIS_TIMEOUT_MS = 20_000;

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
    rate: normalizeProsodyPercent(body.rate, DEFAULT_PROSODY.rate),
    pitch: normalizeProsodyHz(body.pitch, defaultPitchFor(voice)),
    volume: DEFAULT_PROSODY.volume,
  };

  try {
    const tts = new MsEdgeTTS({
      connectionTimeoutMs: 12_000,
      synthesisTimeoutMs: 15_000,
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`TTS synthesis exceeded ${SYNTHESIS_TIMEOUT_MS}ms`)), SYNTHESIS_TIMEOUT_MS);
    });
    try {
      const synthesize = async (): Promise<Buffer> => {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(escapeSsml(text), prosody);
        const chunks: Buffer[] = [];
        for await (const chunk of audioStream) chunks.push(Buffer.from(chunk as Buffer));
        return Buffer.concat(chunks);
      };
      const audio = await Promise.race([synthesize(), timeout]);

      return new Response(new Uint8Array(audio), {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } finally {
      clearTimeout(timeoutId);
      try { tts.close(); } catch { /* best effort */ }
    }
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
