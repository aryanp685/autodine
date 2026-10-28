/**
 * Edge TTS smoke test: does the real synthesis path work from this network?
 *
 * WHY THIS EXISTS
 *
 * The kitchen voice broke in production while every unit test passed,
 * because the failure only happens at the edge of the system: prosody
 * formats a library rejects, a network that cannot reach
 * speech.platform.bing.com, or a change in Microsoft's reverse-engineered
 * Read Aloud API (it has broken before — the Sec-MS-GEC token moved to a
 * custom hash in 2026 and every plain-SHA-256 client started getting 403).
 * A laptop behind a restrictive egress proxy cannot tell these apart — the
 * sandbox this app is developed in cannot reach the service at all. This
 * script probes the pipeline on whatever network it finds itself on and
 * reports one honest result per layer.
 *
 * Layers:
 *   probe1  plain HTTPS to Microsoft — TLS, routing, voice list intact?
 *   probe2  the shipped synthesis path (msedge-tts + shipped prosody) —
 *           the actual product behaviour, verdict of the run
 *
 * edge-tts-universal used to sit between these layers and is deliberately
 * NOT used here: its connect wait never settles on socket errors, so a
 * blocked network and a rejected handshake both look like an infinite
 * hang. Whatever runs in CI must be able to say WHY it failed.
 *
 * Run it in CI (GitHub's runners have open egress) after any change to the
 * TTS stack, or locally on a normal connection:
 *
 *   npx tsx scripts/tts-smoke.ts
 *
 * WHAT IT DOES NOT DO
 *
 * It is not part of the app runtime, stores nothing, and sends one short
 * fixed Hindi sentence. Exit code 0 = synthesis worked; 1 = it did not.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { DEFAULT_EDGE_VOICE, DEFAULT_PITCH, rateToProsody } from '../lib/tts-voices';

/** One short sentence — the same shape the kitchen announces. */
const TEXT = 'नमस्ते, ऑटोडाइन किचन';

/**
 * The voice-list endpoint edge-tts clients talk to (public, token is the
 * well-known Edge Read Aloud client token). Duplicated here so probe1 can
 * observe reachability without any TTS client in the loop.
 */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VOICE_LIST_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;

/** Bound every probe so a blackholed network is a result, not a hang. */
const PROBE_TIMEOUT_MS = 12_000;

function fail(message: string): never {
  console.error(`TTS smoke: FAILED — ${message}`);
  process.exit(1);
}

/** Layer 1: plain HTTPS to Microsoft. Proves TLS + routing + the token. */
async function probeVoiceList(): Promise<void> {
  try {
    const response = await fetch(VOICE_LIST_URL, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const body = await response.text();
    const hasMadhur = body.includes('hi-IN-MadhurNeural');
    console.log(`TTS smoke: probe1 HTTPS voices/list → ${response.status}, ${body.length} bytes, hi-IN-MadhurNeural ${hasMadhur ? 'present' : 'ABSENT'}`);
    if (!response.ok) console.log(`TTS smoke: probe1 body says: ${body.slice(0, 200)}`);
  } catch (error) {
    console.log(`TTS smoke: probe1 HTTPS voices/list → ${error instanceof Error ? `${error.name}: ${error.message}${error.cause ? ` (cause: ${String((error.cause as Error).message ?? error.cause)})` : ''}` : String(error)}`);
  }
}

/**
 * Layer 2: the shipped synthesis path — the actual product behaviour.
 * msedge-tts carries the current Sec-MS-GEC v2 token (custom CS64-SHA256,
 * per upstream rany2/edge-tts PR #492) and rejects on connection/synthesis
 * deadlines instead of hanging, so its errors are real answers.
 */
async function probeSynthesis(): Promise<void> {
  const prosody = {
    voice: DEFAULT_EDGE_VOICE,
    rate: rateToProsody(1.0),
    volume: '+0%',
    pitch: DEFAULT_PITCH,
  };
  console.log(`TTS smoke: shipped prosody ${JSON.stringify(prosody)}`);

  const deadline = setTimeout(() => fail('synthesis did not finish within 25s'), 25_000);
  try {
    const tts = new MsEdgeTTS({ connectionTimeoutMs: PROBE_TIMEOUT_MS, synthesisTimeoutMs: 15_000 });
    await tts.setMetadata(prosody.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const started = Date.now();
    const { audioStream } = tts.toStream(TEXT, {
      rate: prosody.rate,
      pitch: prosody.pitch,
      volume: '+0%',
    });
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
    clearTimeout(deadline);
    tts.close();
    const bytes = Buffer.concat(chunks).length;
    if (bytes <= 0) fail('synthesis returned no audio');
    console.log(`TTS smoke: OK — ${bytes} bytes of MP3 for "${TEXT}" in ${Date.now() - started}ms`);
  } catch (error) {
    clearTimeout(deadline);
    fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

async function main(): Promise<void> {
  await probeVoiceList();
  await probeSynthesis();
}

main();
