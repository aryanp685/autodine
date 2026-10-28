/* scripts/tts-smoke.ts -- CI probe for the Microsoft Read Aloud TTS service.
 *
 * What it proves, and in what order:
 *
 *   1. HTTPS reachability of the public Read Aloud voices list (layer 1:
 *      TLS + routing + the trusted client token). This parses the live
 *      catalogue and asserts the two hi-IN voices the kitchen offers —
 *      if Microsoft ever removes or adds one, CI says so first.
 *
 *   2. SSML shape probes (layer 2a): the Read Aloud endpoint accepts a
 *      subset of SSML, and the subset has never been pinned down. Each
 *      shape the shipped pipeline depends on is synthesized separately so
 *      a failure names exactly which layer broke: plain text (control),
 *      nested per-sentence prosody, and explicit breaks.
 *
 *   3. The shipped synthesis path (layer 2b): msedge-tts synthesizes the
 *      REAL kitchen announcement for BOTH characters — Madhur (male) and
 *      Swara (female) — at their own natural pitch, as one continuous
 *      clip. The MP3s are written to tts-smoke-artifacts/ and uploaded by
 *      the workflow, so a human can listen to what production would say.
 *
 * Every network call is bounded and reports a definitive status instead of
 * hanging. Key results are emitted as GitHub Actions workflow commands
 * (::notice:: / ::error::) so they are readable as check annotations —
 * the raw step logs live on Azure blob storage, which not every reviewer
 * can reach.
 *
 * Secrets required: none — the trusted client token is a public constant
 * shared by every Read Aloud browser extension.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import {
  EDGE_HINDI_VOICES,
  defaultPitchFor,
  escapeSsml,
  rateToProsody,
  segmentsToSsmlInput,
  voiceGender,
} from '../lib/tts-voices';
import { planSpeech, VOICE_TUNING } from '../lib/speech';
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

/** Report a result where both humans and the annotations API can see it. */
function note(message: string): void {
  console.log(`TTS smoke: ${message}`);
  console.log(`::notice title=TTS smoke::${message}`);
}

function fail(message: string): never {
  console.error(`TTS smoke: FAILED — ${message}`);
  console.log(`::error title=TTS smoke FAILED::${message}`);
  process.exit(1);
}

/** Layer 1: plain HTTPS to Microsoft. Proves TLS + routing + the token. */
async function probeVoiceList(): Promise<void> {
  try {
    const response = await fetch(VOICE_LIST_URL, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const body = await response.text();
    const hasMadhur = body.includes('hi-IN-MadhurNeural');
    const hasSwara = body.includes('hi-IN-SwaraNeural');
    note(
      `probe1 HTTPS voices/list → ${response.status}, ${body.length} bytes, ` +
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
      note(`probe1 live hi-IN voices ${JSON.stringify(live)}`);
      note(`probe1 shipped hi-IN voices ${JSON.stringify(ours)}`);
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
      note('probe1 shipped catalogue matches the live service');
    } catch (error) {
      fail(`voices/list response is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    note(`probe1 HTTPS voices/list → ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
}

/**
 * Synthesize one SSML input through the shipped client. Returns byte count
 * or throws with the layer's own error message.
 */
async function synthesize(
  voiceName: string,
  input: string,
  prosody: { rate: string; pitch: string; volume: string },
): Promise<Buffer> {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: PROBE_TIMEOUT_MS, synthesisTimeoutMs: 15_000 });
  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(input, prosody);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } finally {
    try { tts.close(); } catch { /* best effort */ }
  }
}

/** Sanity: an MP3 either starts with an ID3 tag or an MPEG frame sync. */
function assertMp3(audio: Buffer, label: string): void {
  if (audio.length <= 0) fail(`${label} returned no audio`);
  const isMp3 = audio.subarray(0, 3).toString('latin1') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0);
  if (!isMp3) fail(`${label} did not produce MP3 data (first bytes: ${audio.subarray(0, 8).toString('hex')})`);
}

/**
 * One retry after a short pause. The service intermittently throttles
 * shared CI IPs (a known edge-tts failure mode); a single retry separates
 * a blip from a real change without hiding persistent breakage.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    note(`${label} failed once (${message}); retrying in 3s`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return fn();
  }
}

function save(audio: Buffer, fileTag: string): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const file = join(ARTIFACT_DIR, `${fileTag}.mp3`);
  writeFileSync(file, audio);
  note(`saved ${audio.length} bytes → ${file}`);
}

/**
 * Layer 2a: pin down which SSML shapes the Read Aloud endpoint accepts.
 * The shipped pipeline depends on nested prosody (per-sentence rates) and
 * breaks (planned pauses); the endpoint speaks an undocumented subset, so
 * each shape is verified separately before the full announcement runs.
 */
async function probeSsmlShapes(voiceName: string): Promise<void> {
  const pitch = defaultPitchFor(voiceName);
  const prosody = { rate: '+0%', pitch, volume: '+0%' };
  const shapes: { label: string; input: string }[] = [
    { label: 'plain-text', input: escapeSsml('नमस्ते दोस्तों, कैसे हो।') },
    { label: 'nested-prosody', input: `<prosody rate="+8%">${escapeSsml('नमस्ते दोस्तों')}</prosody>` },
    { label: 'break', input: `${escapeSsml('नमस्ते')} <break time="200ms"/> ${escapeSsml('दोस्तों')}` },
    { label: 'segments', input: segmentsToSsmlInput([
      { text: 'नमस्ते दोस्तों', rate: '+8%' },
      { text: 'कैसे हो', rate: '+11%', breakBeforeMs: 200 },
    ], prosody.rate) },
  ];

  for (const shape of shapes) {
    try {
      const audio = await withRetry(() => synthesize(voiceName, shape.input, prosody), `shape ${shape.label}`);
      assertMp3(audio, shape.label);
      note(`shape ${shape.label} → OK, ${audio.length} bytes`);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      // The exact answer decides the implementation: if a shipped shape is
      // rejected here while plain-text works, the pipeline must change.
      fail(`shape ${shape.label} rejected by the service — ${message} — input: ${shape.input.slice(0, 200)}`);
    }
  }
}

/**
 * Layer 2b: the shipped synthesis path — the actual product behaviour, for
 * both kitchen characters, each with its own natural pitch. The
 * announcement is paced exactly the way the kitchen engine paces it:
 * sentences at their planned rates, the planned pauses as SSML breaks,
 * one continuous clip per character.
 */
async function probeSynthesis(voiceName: string, fileTag: string): Promise<void> {
  // Mirror lib/server-speech.ts: same plan, same rate maths, same SSML.
  const segments = planSpeech(ANNOUNCEMENT).map((segment, index, plan) => ({
    text: segment.text.replace(/[।.!?\s]+$/u, '').trim(),
    rate: rateToProsody(Math.min(1.5, Math.max(0.5, VOICE_TUNING.rate * segment.rate))),
    breakBeforeMs: index === 0 ? 0 : plan[index - 1].gapMs + segment.leadMs,
  }));
  const prosody = { voice: voiceName, rate: '+0%', volume: '+0%', pitch: defaultPitchFor(voiceName) };
  note(`shipped prosody ${JSON.stringify(prosody)} with ${segments.length} segments`);

  const deadline = setTimeout(() => fail(`synthesis of ${voiceName} did not finish within 25s`), 25_000);
  try {
    const audio = await withRetry(() => synthesize(
      voiceName,
      segmentsToSsmlInput(segments, prosody.rate),
      { rate: prosody.rate, pitch: prosody.pitch, volume: prosody.volume },
    ), `synthesis of ${voiceName}`);
    clearTimeout(deadline);
    assertMp3(audio, `synthesis of ${voiceName}`);
    save(audio, `${fileTag}-${voiceName}`);
    note(`announcement clip for ${voiceName} → ${audio.length} bytes`);
  } catch (error) {
    clearTimeout(deadline);
    fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

async function main(): Promise<void> {
  note(`announcement text ${ANNOUNCEMENT}`);
  await probeVoiceList();
  // SSML shape support first, so a shape rejection is named, not guessed.
  await probeSsmlShapes(EDGE_HINDI_VOICES[0].name);
  // Both characters, in the order the picker lists them.
  for (const voice of EDGE_HINDI_VOICES) {
    await probeSynthesis(voice.name, voiceGender(voice.name) === 'Female' ? 'female' : 'male');
  }
  note('voice list, SSML shapes, and both synthesis probes passed');
}

main();
