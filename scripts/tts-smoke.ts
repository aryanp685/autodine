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
 * all. This script probes each layer of the pipeline on whatever network it
 * finds itself on and reports one honest result per layer.
 *
 * The layers exist because edge-tts-universal HIDS connection failures:
 * its connect wait is `await new Promise(resolve => ws.on('open', resolve))`
 * and never settles when the socket errors — a blocked network and a
 * silently-rejected handshake both look like an infinite hang. So the
 * probes below use plain fetch and a raw WebSocket (with the same DRM
 * token the library generates) to see how the connection actually settles,
 * then run the shipped synthesis path as the final verdict.
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

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { Communicate, EdgeTTS, IsomorphicDRM } from 'edge-tts-universal';
import { DEFAULT_EDGE_VOICE, DEFAULT_PITCH, rateToProsody } from '../lib/tts-voices';

/** One short sentence — the same shape the kitchen announces. */
const TEXT = 'नमस्ते, ऑटोडाइन किचन';

/**
 * The endpoints edge-tts-universal talks to (src/constants.ts there). Duplicated
 * here so the probes can observe the connection without the library's silent
 * hang; if Microsoft moves the service, this is where the smoke test notices.
 */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_MAJOR_VERSION = '143';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_MAJOR_VERSION}.0.3650.75`;
const VOICE_LIST_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
const WSS_BASE = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

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

/** Layer 2: the WebSocket upgrade with the library's own DRM token. */
async function probeWebSocket(): Promise<void> {
  let settle = '';
  try {
    const secMsGec = await IsomorphicDRM.generateSecMsGec();
    const url = `${WSS_BASE}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${randomUUID()}`;
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(url, {
        headers: IsomorphicDRM.headersWithMuid({
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'Sec-WebSocket-Version': '13',
        }),
        handshakeTimeout: PROBE_TIMEOUT_MS,
      });
      const timer = setTimeout(() => {
        settle = `no settle within ${PROBE_TIMEOUT_MS}ms (connection blackholed or hung)`;
        try { ws.terminate(); } catch { /* */ }
        resolve();
      }, PROBE_TIMEOUT_MS + 500);
      ws.on('open', () => { settle = 'open — WebSocket handshake accepted'; clearTimeout(timer); try { ws.close(); } catch { /* */ } resolve(); });
      ws.on('error', (error) => { settle = `error — ${error.message}`; clearTimeout(timer); resolve(); });
      ws.on('close', (code) => { if (!settle) settle = `closed before open — code ${code}`; clearTimeout(timer); resolve(); });
    });
    console.log(`TTS smoke: probe2 WebSocket handshake → ${settle}`);
  } catch (error) {
    console.log(`TTS smoke: probe2 WebSocket handshake → ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
}

/** Layer 3: the shipped synthesis path — the actual product behaviour. */
async function probeSynthesis(): Promise<void> {
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

  const deadline = setTimeout(() => fail('synthesis did not finish within 25s (edge-tts-universal hangs silently on connection failures)'), 25_000);
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

async function main(): Promise<void> {
  await probeVoiceList();
  await probeWebSocket();
  await probeSynthesis();
}

main();
