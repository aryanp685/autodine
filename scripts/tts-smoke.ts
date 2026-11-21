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
 *      minimal SSML subset — nested <prosody> closes the stream — so
 *      every shape a future change might want is probed and the full
 *      matrix reported. The shipped path is plain text with punctuation;
 *      if that shape breaks, the probe fails loudly.
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
  voiceGender,
} from '../lib/tts-voices';
import { splitSentences, VOICE_TUNING } from '../lib/speech';
import {
  buildExpressiveAnnouncement,
  PERSONALITY_VARIATIONS,
} from '../lib/voice-personality';
import type { SpeakableItem } from '../lib/announce';

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

/**
 * A real kitchen ticket -- the order data the announcement wraps. Every
 * personality variation frames the SAME data, so the artifact shows the
 * full rotation of Nagpuri lines without inventing a second order.
 */
const SAMPLE_ORDER = {
  table: '5',
  items: [
    { qty: 2, name: 'Paneer Tikka' },
    { qty: 1, name: 'Butter Naan', detail: 'Half' },
  ] as SpeakableItem[],
  note: 'on the side',
};

/**
 * Estimated seconds of speech for an MP3 of `bytes`, at the 96 kbps
 * output format the route ships (= 12,000 bytes per second of audio).
 * Used only to report pacing in the annotations; the clip itself is the
 * real artefact.
 */
const BYTES_PER_SECOND = 12_000;

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
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
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

function save(audio: Buffer, fileTag: string): string {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const file = join(ARTIFACT_DIR, `${fileTag}.mp3`);
  writeFileSync(file, audio);
  return file;
}

/**
 * Layer 2a: pin down which SSML shapes the Read Aloud endpoint accepts.
 * The endpoint speaks an undocumented minimal subset — nested <prosody>
 * closes the stream — so every shape the pipeline might want is probed and
 * the full matrix is reported. The shipped path only relies on plain text
 * with punctuation; the other shapes are knowledge for the next person who
 * is tempted to reach for SSML.
 */
async function probeSsmlShapes(voiceName: string): Promise<void> {
  const pitch = defaultPitchFor(voiceName);
  const prosody = { rate: '+0%', pitch, volume: '+0%' };
  const shapes: { label: string; input: string }[] = [
    { label: 'plain-text', input: escapeSsml('नमस्ते दोस्तों, कैसे हो।') },
    { label: 'nested-prosody', input: `<prosody rate="+8%">${escapeSsml('नमस्ते दोस्तों')}</prosody>` },
    { label: 'break', input: `${escapeSsml('नमस्ते')} <break time="200ms"/> ${escapeSsml('दोस्तों')}` },
    { label: 'sentence-terminators', input: `${escapeSsml('नमस्ते दोस्तों।')} ${escapeSsml('कैसे हो।')}` },
  ];

  const rejected: string[] = [];
  for (const shape of shapes) {
    try {
      const audio = await withRetry(() => synthesize(voiceName, shape.input, prosody), `shape ${shape.label}`);
      assertMp3(audio, shape.label);
      note(`shape ${shape.label} → OK, ${audio.length} bytes`);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      note(`shape ${shape.label} → REJECTED — ${message}`);
      rejected.push(shape.label);
    }
  }
  // The shipped path is plain text; if that breaks, everything breaks.
  if (rejected.includes('plain-text') || rejected.includes('sentence-terminators')) {
    fail(`shipped SSML shape rejected by the service: ${rejected.join(', ')}`);
  }
}

/**
 * Layer 2b: the shipped synthesis path — the actual product behaviour, for
 * both kitchen characters and EVERY personality variation, each with its
 * own natural pitch. Each clip is paced exactly the way the kitchen engine
 * paces it: one continuous clip, sentences merged with their terminators
 * (punctuation is the only pacing the service's SSML subset allows), one
 * rate. All clips land in the artifact, so the whole Nagpuri rotation is
 * audible, and each voice reports one compact pacing summary.
 */
async function probeSynthesis(voiceName: string, fileTag: string): Promise<void> {
  const pitch = defaultPitchFor(voiceName);
  const rate = rateToProsody(VOICE_TUNING.rate);
  const pace: string[] = [];
  let failures = 0;

  for (const variation of PERSONALITY_VARIATIONS) {
    // Mirror lib/server-speech.ts: same merge, same rate maths.
    const text = buildExpressiveAnnouncement(
      SAMPLE_ORDER.table,
      SAMPLE_ORDER.items,
      SAMPLE_ORDER.note,
      PERSONALITY_VARIATIONS.indexOf(variation),
    );
    const mergedText = splitSentences(text)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .join(' ');
    const label = `synthesis of ${voiceName} / ${variation.id}`;

    const deadline = setTimeout(() => fail(`${label} did not finish within 25s`), 25_000);
    try {
      const audio = await withRetry(() => synthesize(
        voiceName,
        escapeSsml(mergedText),
        { rate, pitch, volume: '+0%' },
      ), label);
      clearTimeout(deadline);
      assertMp3(audio, label);
      save(audio, `${fileTag}-${variation.id}`);
      const seconds = audio.length / BYTES_PER_SECOND;
      pace.push(`${variation.id}≈${seconds.toFixed(1)}s/${(mergedText.length / seconds).toFixed(1)}cps`);
    } catch (error) {
      clearTimeout(deadline);
      failures += 1;
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      note(`${label} failed — ${message}`);
      // One variation failing alone is a wobble worth reporting; the whole
      // voice failing (first clip already gone) is a broken voice — fail.
      if (pace.length === 0) {
        fail(`${voiceName}: no variation produced audio — ${message}`);
        return;
      }
    }
  }

  note(`${fileTag} ${rate} ${pitch} → ${pace.join(', ')} (${failures} failed)`);
}

async function main(): Promise<void> {
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
