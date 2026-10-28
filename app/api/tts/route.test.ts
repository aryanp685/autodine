import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The /api/tts relay.
 *
 * The thread through these tests: what the kitchen engine sends and what
 * the TTS client accepts must never drift apart again. The relay used to
 * pass the client's prosody strings straight through with decimal formats
 * ("+0.00%"), which the then-library rejected with `Invalid rate
 * '+0.00%'` — every request answered 503 and the kitchen silently fell
 * back to the device's (often female) Hindi voice. The route must coerce
 * prosody to the integer SSML format even when a stale client bundle
 * still sends decimals, escape SSML metacharacters in dish names, and
 * answer 503 (never hang) when the service misbehaves.
 */

const mocks = vi.hoisted(() => ({
  setMetadata: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  toStream: vi.fn(),
  close: vi.fn(),
  constructed: [] as unknown[],
  setMetadataCalls: [] as { voice: string; format: unknown }[],
  streamCalls: [] as { input: string; prosody: unknown }[],
}));

vi.mock('msedge-tts', () => ({
  MsEdgeTTS: class {
    constructor(options?: unknown) {
      mocks.constructed.push(options);
    }

    setMetadata(voice: string, format: unknown) {
      mocks.setMetadataCalls.push({ voice, format });
      return mocks.setMetadata(voice, format);
    }

    toStream(input: string, prosody: unknown) {
      mocks.streamCalls.push({ input, prosody });
      return mocks.toStream(input, prosody);
    }

    close() {
      return mocks.close();
    }
  },
  OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3' },
}));

import { POST } from './route';

function post(body: unknown): Request {
  return new Request('http://localhost/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** A stream that yields the given bytes and ends. */
function streamOf(...chunks: Buffer[]): { audioStream: AsyncGenerator<Buffer> } {
  return {
    audioStream: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
  };
}

class ValueErrorStub extends Error {}

describe('POST /api/tts', () => {
  beforeEach(() => {
    mocks.constructed.length = 0;
    mocks.setMetadataCalls.length = 0;
    mocks.streamCalls.length = 0;
    mocks.setMetadata.mockReset();
    mocks.setMetadata.mockResolvedValue(undefined);
    mocks.close.mockReset();
    mocks.toStream.mockReset();
    mocks.toStream.mockImplementation(() => streamOf(Buffer.from([1, 2, 3])));
    // The route logs failures on purpose — keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns audio/mpeg for a valid request', async () => {
    const response = await POST(post({ text: 'नमस्ते' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(mocks.setMetadataCalls[0].voice).toBe('hi-IN-MadhurNeural');
    expect(mocks.streamCalls).toHaveLength(1);
  });

  it('passes integer SSML prosody through to the client', async () => {
    await POST(post({ text: 'नमस्ते' }));

    const { prosody } = mocks.streamCalls[0] as { prosody: Record<string, string> };
    // Defaults must be integers too — '+0.00%' was the production killer.
    expect(prosody.rate).toMatch(/^[+-]\d+%$/);
    expect(prosody.volume).toMatch(/^[+-]\d+%$/);
    expect(prosody.pitch).toMatch(/^[+-]\d+Hz$/);
  });

  it('coerces legacy decimal prosody from stale client bundles', async () => {
    await POST(post({ text: 'नमस्ते', rate: '+0.00%', pitch: '-20Hz' }));

    const { prosody } = mocks.streamCalls[0] as { prosody: Record<string, string> };
    expect(prosody.rate).toBe('+0%');
    expect(prosody.pitch).toBe('-20Hz');
    expect(prosody.volume).toBe('+0%');
  });

  it('coerces fractional prosody to integers', async () => {
    await POST(post({ text: 'नमस्ते', rate: '-8.00%', pitch: '-19.8Hz' }));

    const { prosody } = mocks.streamCalls[0] as { prosody: Record<string, string> };
    expect(prosody.rate).toBe('-8%');
    expect(prosody.pitch).toBe('-20Hz');
  });

  it('falls back to defaults for garbage prosody instead of failing', async () => {
    await POST(post({ text: 'नमस्ते', rate: 'ludicrous', pitch: 'deep' }));

    const { prosody } = mocks.streamCalls[0] as { prosody: Record<string, string> };
    expect(prosody.rate).toBe('+0%');
    expect(prosody.pitch).toBe('-4Hz'); // the default voice's natural pitch
  });

  it('falls back to the default voice for an unknown voice name', async () => {
    await POST(post({ text: 'नमस्ते', voice: 'hi-IN-NonExistentNeural' }));

    expect(mocks.setMetadataCalls[0].voice).toBe('hi-IN-MadhurNeural');
  });

  it('accepts a voice from the catalogue', async () => {
    await POST(post({ text: 'नमस्ते', voice: 'hi-IN-SwaraNeural' }));

    expect(mocks.setMetadataCalls[0].voice).toBe('hi-IN-SwaraNeural');
  });

  it('defaults each voice to its own natural pitch', async () => {
    // The female voice must never inherit the male voice's warmth.
    await POST(post({ text: 'नमस्ते', voice: 'hi-IN-SwaraNeural' }));
    let { prosody } = mocks.streamCalls.at(-1) as { prosody: Record<string, string> };
    expect(prosody.pitch).toBe('+0Hz');

    await POST(post({ text: 'नमस्ते' }));
    ({ prosody } = mocks.streamCalls.at(-1) as { prosody: Record<string, string> });
    expect(prosody.pitch).toBe('-4Hz');
  });

  it('folds paced segments into one continuous SSML voice', async () => {
    // The kitchen engine sends the whole announcement as segments — one
    // synthesis, sentences at their own rates, planned pauses as breaks.
    await POST(post({
      segments: [
        { text: 'नया ऑर्डर, टेबल टी वन', rate: '+8%' },
        { text: 'दो बटर नान', rate: '+11%', breakBeforeMs: 160 },
      ],
    }));

    const { input } = mocks.streamCalls.at(-1) as { input: string };
    expect(input).toBe(
      '<prosody rate="+8%">नया ऑर्डर, टेबल टी वन</prosody> <break time="160ms"/> <prosody rate="+11%">दो बटर नान</prosody>',
    );
  });

  it('leaves a segment unwrapped when its rate is the default', async () => {
    await POST(post({
      segments: [
        { text: 'नया ऑर्डर', rate: '+0%' },
        { text: 'दो बटर नान' },
      ],
    }));

    const { input } = mocks.streamCalls.at(-1) as { input: string };
    expect(input).toBe('नया ऑर्डर दो बटर नान');
  });

  it('coerces garbage segment prosody instead of failing', async () => {
    await POST(post({
      segments: [
        { text: 'नया ऑर्डर', rate: '+8.00%' },
        { text: 'दो बटर नान', rate: 'ludicrous', breakBeforeMs: Number.NaN },
      ],
    }));

    const { input } = mocks.streamCalls.at(-1) as { input: string };
    expect(input).toBe('<prosody rate="+8%">नया ऑर्डर</prosody> दो बटर नान');
  });

  it('rejects malformed segments with 400', async () => {
    const bad: unknown[] = [
      { segments: [] },
      { segments: [{ text: '   ' }] },
      { segments: [{ text: 42 }] },
      { segments: Array.from({ length: 25 }, () => ({ text: 'x' })) },
    ];
    for (const body of bad) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.streamCalls).toHaveLength(0);
  });

  it('escapes SSML metacharacters in announcement text', async () => {
    // Dish names like "Fish & Chips" or "Dal <special>" are malformed SSML
    // if passed through raw — the synthesis request would be rejected.
    await POST(post({ text: 'Fish & Chips <hot>' }));

    expect(mocks.streamCalls[0].input).toBe('Fish &amp; Chips &lt;hot&gt;');
  });

  it('rejects a missing text with 400', async () => {
    const response = await POST(post({}));
    expect(response.status).toBe(400);
    expect(mocks.streamCalls).toHaveLength(0);
  });

  it('rejects invalid JSON with 400', async () => {
    const response = await POST(post('not json'));
    expect(response.status).toBe(400);
  });

  it('answers 503 when the client fails to connect', async () => {
    mocks.setMetadata.mockRejectedValue(new ValueErrorStub('Edge TTS WebSocket error'));

    const response = await POST(post({ text: 'नमस्ते' }));

    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('TTS service unavailable');
  });

  it('answers 503 when synthesis hangs past the deadline', async () => {
    vi.useFakeTimers();
    try {
      // A stream that never yields — the audio loop would wait forever.
      mocks.toStream.mockReturnValue({
        audioStream: (async function* () {
          await new Promise(() => { /* never settles */ });
        })(),
      });

      const pending = POST(post({ text: 'नमस्ते' }));
      await vi.advanceTimersByTimeAsync(20_000);
      const response = await pending;

      expect(response.status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the client connection after success and failure', async () => {
    await POST(post({ text: 'नमस्ते' }));
    expect(mocks.close).toHaveBeenCalledTimes(1);

    mocks.setMetadata.mockRejectedValue(new ValueErrorStub('gone'));
    await POST(post({ text: 'नमस्ते' }));
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});
