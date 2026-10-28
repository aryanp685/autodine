import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The /api/tts relay.
 *
 * The thread through these tests: what the kitchen engine sends and what
 * edge-tts-universal will accept must never drift apart again. The relay
 * used to pass the client's prosody strings straight through with decimal
 * formats ("+0.00%") — edge-tts-universal rejects those with
 * `Invalid rate '+0.00%'`, every request answered 503, and the kitchen
 * silently fell back to the device's (often female) Hindi voice. The route
 * must coerce prosody to the integer format the library validates, even
 * when a stale client bundle still sends decimals.
 */

const mocks = vi.hoisted(() => ({
  synthesize: vi.fn(),
  constructed: [] as { text: string; voice: string; prosody: Record<string, string> }[],
}));

vi.mock('edge-tts-universal', () => ({
  EdgeTTS: class {
    constructor(text: string, voice: string, prosody: Record<string, string>) {
      mocks.constructed.push({ text, voice, prosody });
    }

    synthesize() {
      return mocks.synthesize();
    }
  },
}));

import { POST } from './route';

function post(body: unknown): Request {
  return new Request('http://localhost/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

class ValueErrorStub extends Error {}

describe('POST /api/tts', () => {
  beforeEach(() => {
    mocks.constructed.length = 0;
    mocks.synthesize.mockReset();
    // The route logs failures on purpose — keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns audio/mpeg for a valid request', async () => {
    mocks.synthesize.mockResolvedValue({
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
    });

    const response = await POST(post({ text: 'नमस्ते' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(mocks.constructed).toHaveLength(1);
    expect(mocks.constructed[0].text).toBe('नमस्ते');
    expect(mocks.constructed[0].voice).toBe('hi-IN-MadhurNeural');
  });

  it('passes integer prosody to the library — the library refuses decimals', async () => {
    mocks.synthesize.mockResolvedValue({
      audio: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
    });

    await POST(post({ text: 'नमस्ते' }));

    const { prosody } = mocks.constructed[0];
    // Defaults must be integers too — '+0.00%' here would 503 every call.
    expect(prosody.rate).toMatch(/^[+-]\d+%$/);
    expect(prosody.volume).toMatch(/^[+-]\d+%$/);
    expect(prosody.pitch).toMatch(/^[+-]\d+Hz$/);
  });

  it('coerces legacy decimal prosody from stale client bundles', async () => {
    mocks.synthesize.mockResolvedValue({
      audio: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
    });

    await POST(post({ text: 'नमस्ते', rate: '+0.00%', pitch: '-20Hz' }));

    const { prosody } = mocks.constructed[0];
    expect(prosody.rate).toBe('+0%');
    expect(prosody.pitch).toBe('-20Hz');
    expect(prosody.volume).toBe('+0%');
  });

  it('coerces fractional prosody to integers', async () => {
    mocks.synthesize.mockResolvedValue({
      audio: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
    });

    await POST(post({ text: 'नमस्ते', rate: '-8.00%', pitch: '-19.8Hz' }));

    const { prosody } = mocks.constructed[0];
    expect(prosody.rate).toBe('-8%');
    expect(prosody.pitch).toBe('-20Hz');
  });

  it('falls back to defaults for garbage prosody instead of failing', async () => {
    mocks.synthesize.mockResolvedValue({
      audio: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
    });

    await POST(post({ text: 'नमस्ते', rate: 'ludicrous', pitch: 'deep' }));

    const { prosody } = mocks.constructed[0];
    expect(prosody.rate).toBe('+0%');
    expect(prosody.pitch).toBe('-20Hz');
  });

  it('falls back to the default voice for an unknown voice name', async () => {
    mocks.synthesize.mockResolvedValue({
      audio: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
    });

    await POST(post({ text: 'नमस्ते', voice: 'hi-IN-NonExistentNeural' }));

    expect(mocks.constructed[0].voice).toBe('hi-IN-MadhurNeural');
  });

  it('accepts a voice from the catalogue', async () => {
    mocks.synthesize.mockResolvedValue({
      audio: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
    });

    await POST(post({ text: 'नमस्ते', voice: 'hi-IN-AaravNeural' }));

    expect(mocks.constructed[0].voice).toBe('hi-IN-AaravNeural');
  });

  it('rejects a missing text with 400', async () => {
    const response = await POST(post({}));
    expect(response.status).toBe(400);
    expect(mocks.constructed).toHaveLength(0);
  });

  it('rejects invalid JSON with 400', async () => {
    const response = await POST(post('not json'));
    expect(response.status).toBe(400);
  });

  it('answers 503 when synthesis fails', async () => {
    mocks.synthesize.mockRejectedValue(new ValueErrorStub('service went away'));

    const response = await POST(post({ text: 'नमस्ते' }));

    expect(response.status).toBe(503);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('TTS service unavailable');
  });

  it('answers 503 when synthesis hangs past the deadline', async () => {
    vi.useFakeTimers();
    try {
      mocks.synthesize.mockReturnValue(new Promise(() => { /* never settles */ }));

      const pending = POST(post({ text: 'नमस्ते' }));
      await vi.advanceTimersByTimeAsync(20_000);
      const response = await pending;

      expect(response.status).toBe(503);
    } finally {
      vi.useRealTimers();
    }
  });
});
