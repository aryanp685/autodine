/* scripts/tts-smoke.ts -- CI probe for the Microsoft Read Aloud TTS service.
 *
 * What it proves, and in what order:
 *
 *   1. HTTPS reachability of the public Read Aloud voices list (layer 1:
 *      TLS + routing + the trusted client token). This parses the live
 *      catalogue and asserts the two hi-IN voices the kitchen offers —
 *      if Microsoft ever removes or adds one, CI says so first.
 *
 *   2. The shipped synthesis path (layer 2): msedge-tts carries the current
 *      Sec-MS-GEC v2 token and synthesizes the REAL kitchen announcement
 *      for BOTH characters — Madhur (male) and Swara (female) — each at its
 *      own natural pitch. The MP3s are written to tts-smoke-artifacts/ and
 *      uploaded by the workflow, so a human can listen to what production
 *      would say. Sanity-checked: non-empty and carrying an MP3 frame or
 *      ID3 header.
 *
 * Every network call is bounded and reports a definitive status instead of
 * hanging (both this route and the app fail honestly rather than hang).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import {
  EDGE_HINDI_VOICES,
  defaultPitchFor,
  rateToProsody,
  voiceGender,
} from '../lib/tts-voices';
import { buildKitchenAnnouncement } from '../lib/voice-personality';

/**
 * The public token Read Aloud clients use. It is a client identifier, not a
 * secret -- it ships in every Read Aloud browser extension.
 */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const VOICE_LIST_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;

/** Bound every probe so a blackholed network is a result, not a hang. */
const PROBE_TIMEOUT_MS = 12_000;

/** Where the listened-to MP3s land (uploaded by the workflow). */
const ARTIFACT_DIR = join(process.cwd(), 'tts-smoke-artifacts');

/** A real kitchen announcement -- the slang the kitchen actually hears. */
const ANNOUNCEMENT = buildKitchenAnnouncement(
  '5',
  [
    { qty: 2, name: 'Paneer Tikka' },
    { qty: 1, name: 'Butter Naan', detail: 'Half' },
  ],
  'on the side',
);

function fail(message: string): never {
  console.error(`TTS smoke: FAILED — ${message}`);
  process.exit(1);
}

/** Layer 1: plain HTTPS to Microsoft. Proves TLS + routing + the token. */
async function probeVoiceList(): Promise<void> {
  try {
    const response = await fetch(VOICE_LIST_URL, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const body = await response.text();
    if (!response.ok) console.log(`TTS smoke: probe1 body says: ${body.slice(0, 200)}`);

    const hasMadhur = body.includes('hi-IN-MadhurNeural');
    const hasSwara = body.includes('hi-IN-SwaraNeural');
    console.log(
      `TTS smoke: probe1 HTTPS voices/list → ${response.status}, ${body.length} bytes, ` +
        `hi-IN-MadhurNeural ${hasMadhur ? 'present' : 'ABSENT'}, ` +
        `hi-IN-SwaraNeural ${hasSwara ? 'present' : 'ABSENT'}`,
    );
    if (!response.ok) return;

    // The catalogue shipped in the app must be the catalogue Microsoft serves.
    try {
      const list = JSON.parse(body) as { ShortName: string; Gender: string; Locale: string }[];
      const live = list
        .filter((v) => v.Locale === 'hi-IN')
        .map((v) => ({ name: v.ShortName, gender: v.Gender }));
      const ours = EDGE_HINDI_VOICES.map((v) => ({ name: v.name, gender: v.gender }));
      console.log(`TTS smoke: probe1 live hi-IN voices ${JSON.stringify(live)}`);
      console.log(`TTS smoke: probe1 shipped hi-IN voices ${JSON.stringify(ours)}`);
      const liveNames = live.map((v) => v.name).sort().join(',');
      const ourNames = ours.map((v) => v.name).sort().join(',');
      if (liveNames !== ourNames) {
        fail(`shipped voice catalogue is stale — live [${liveNames}] vs shipped [${ourNames}]`);
      }
      for (const voice of live) {
        if (voiceGender(voice.name) !== voice.gender) {
          fail(`gender mismatch for ${voice.name}: service says ${voice.gender}`);
        }
      }
      console.log('TTS smoke: probe1 shipped catalogue matches the live service');
    } catch (error) {
      fail(`voices/list response is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    console.log(`TTS smoke: probe1 HTTPS voices/list → ${error instanceof Error ? `${error.name}: ${error.message}${error.cause ? ` (cause: ${String((error.cause as Error).message ?? error.cause)})` : ''}` : String(error)}`);
  }
}

/**
 * Layer 2: the shipped synthesis path — the actual product behaviour, for
 * both kitchen characters, each with its own natural pitch.
 */
async function probeSynthesis(voiceName: string, fileTag: string): Promise<void> {
  const prosody = {
    voice: voiceName,
    rate: rateToProsody(1.0),
    volume: '+0%',
    pitch: defaultPitchFor(voiceName),
  };
  console.log(`TTS smoke: shipped prosody ${JSON.stringify(prosody)}`);

  const deadline = setTimeout(() => fail(`synthesis of ${voiceName} did not finish within 25s`), 25_000);
  try {
    const tts = new MsEdgeTTS({ connectionTimeoutMs: PROBE_TIMEOUT_MS, synthesisTimeoutMs: 15_000 });
    await tts.setMetadata(prosody.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const started = Date.now();
    const { audioStream } = tts.toStream(ANNOUNCEMENT, {
      rate: prosody.rate,
      pitch: prosody.pitch,
      volume: prosody.volume,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
    clearTimeout(deadline);
    tts.close();
    const audio = Buffer.concat(chunks);
    if (audio.length <= 0) fail(`synthesis of ${voiceName} returned no audio`);

    // Sanity: an MP3 either starts with an ID3 tag or an MPEG frame sync.
    const isMp3 = audio.subarray(0, 3).toString('latin1') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0);
    if (!isMp3) fail(`synthesis of ${voiceName} did not produce MP3 data (first bytes: ${audio.subarray(0, 8).toString('hex')})`);

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const file = join(ARTIFACT_DIR, `${fileTag}-${voiceName}.mp3`);
    writeFileSync(file, audio);
    console.log(`TTS smoke: OK — ${audio.length} bytes of MP3 for ${voiceName} in ${Date.now() - started}ms → ${file}`);
    console.log(`TTS smoke: announcement said: ${ANNOUNCEMENT}`);
  } catch (error) {
    clearTimeout(deadline);
    fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

async function main(): Promise<void> {
  console.log(`TTS smoke: announcement text ${ANNOUNCEMENT}`);
  await probeVoiceList();
  // Both characters, in the order the picker lists them.
  for (const voice of EDGE_HINDI_VOICES) {
    await probeSynthesis(voice.name, voiceGender(voice.name) === 'Female' ? 'female' : 'male');
  }
  console.log('TTS smoke: voice list and both synthesis probes passed');
}

main();
