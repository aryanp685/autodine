/**
 * Edge TTS smoke test: does the real synthesis path work from this network?
 *
 * WHY THIS EXISTS
 *
 * The kitchen voice broke in production while every unit test passed,
 * because the failure only happens at the edge of the system: prosody
 * strings that edge-tts-universal rejects, a network that cannot reach
 * speech.platform.bing.com, or a change in Microsoft's reverse-engineered
 * endpoint. A laptop behind a restrictive egress proxy cannot tell these
 * apart — the sandbox this app is developed in cannot reach the service at
 * all. This script runs the SHIPPED prosody values (lib/tts-voices.ts)
 * through the SHIPPED library on whatever network it finds itself on and
 * reports one honest result: MP3 bytes came back, or here is why not.
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

import { Communicate, EdgeTTS } from 'edge-tts-universal';
import { DEFAULT_EDGE_VOICE, DEFAULT_PITCH, rateToProsody } from '../lib/tts-voices';

/** One short sentence — the same shape the kitchen announces. */
const TEXT = 'नमस्ते, ऑटोडाइन किचन';

function fail(message: string): never {
  console.error(`TTS smoke: FAILED — ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // 1. Validation gate: the formats the app ships must pass the library's
  // own validator. This is the exact check that killed every /api/tts call
  // when prosody was formatted with decimals ("+0.00%").
  const prosody = {
    voice: DEFAULT_EDGE_VOICE,
    rate: rateToProsody(1.0),
    volume: '+0%',
    pitch: DEFAULT_PITCH,
  };
  try {
    new Communicate(TEXT, prosody);
    console.log(`TTS smoke: prosody ${JSON.stringify(prosody)} accepted by edge-tts-universal`);
  } catch (error) {
    fail(`library rejected shipped prosody: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Synthesis over the network. A hang is a failure too — bound it.
  const deadline = setTimeout(() => fail('synthesis did not finish within 25s'), 25_000);
  try {
    const tts = new EdgeTTS(TEXT, DEFAULT_EDGE_VOICE, {
      rate: prosody.rate,
      volume: prosody.volume,
      pitch: prosody.pitch,
    });
    const started = Date.now();
    const result = await tts.synthesize();
    clearTimeout(deadline);
    const bytes = result.audio.size;
    if (bytes <= 0) fail('synthesis returned an empty audio blob');
    console.log(`TTS smoke: OK — ${bytes} bytes of MP3 for "${TEXT}" in ${Date.now() - started}ms`);
  } catch (error) {
    clearTimeout(deadline);
    fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

main();
