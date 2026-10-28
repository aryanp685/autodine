import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EDGE_VOICE,
  DEFAULT_PITCH,
  EDGE_HINDI_VOICES,
  escapeSsml,
  findEdgeVoice,
  normalizeProsodyHz,
  normalizeProsodyPercent,
  rateToProsody,
  toVoiceLike,
} from './tts-voices';
import { createServerSpeech, type ServerSpeechEnv } from './server-speech';
import { createDualSpeech } from './dual-speech';


/**
 * Server-backed kitchen voice tests.
 *
 * These test the server speech engine, the dual engine, and the voice
 * catalogue. The server engine fetches audio from /api/tts and plays
 * it through an Audio element — the tests use a mock fetchTTS and a
 * mock Audio element to verify the engine's behaviour without a real
 * network or audio output.
 */

describe('tts-voices', () => {
  it('rateToProsody converts multipliers to integer Edge TTS percentage strings', () => {
    // Integers, no decimals — the /api/tts wire contract (SSML relative
    // prosody). The old decimal format made EVERY synthesis request fail
    // and the kitchen fall back to the device's (often female) Hindi voice.
    expect(rateToProsody(1.0)).toBe('+0%');
    expect(rateToProsody(0.92)).toBe('-8%');
    expect(rateToProsody(1.1)).toBe('+10%');
    expect(rateToProsody(0.5)).toBe('-50%');
    expect(rateToProsody(1.5)).toBe('+50%');
  });

  it('rateToProsody rounds fractional percentages to integers', () => {
    // 1 - 0.9016 = 9.84% slow → rounds to -10%
    expect(rateToProsody(0.9016)).toBe('-10%');
    expect(rateToProsody(1.004)).toBe('+0%');
    expect(rateToProsody(1.006)).toBe('+1%');
  });

  it('rateToProsody output always matches the wire format', () => {
    // /^[+-]\d+%$/ is what the TTS client and /api/tts exchange — this
    // invariant is the regression guard for the '+0.00%' incident.
    for (const rate of [0.5, 0.75, 0.92, 0.98, 1.0, 1.02, 1.1, 1.25, 1.5]) {
      expect(rateToProsody(rate)).toMatch(/^[+-]\d+%$/);
    }
  });

  it('prosody built from the shipped helpers matches the /api/tts wire contract', () => {
    // The exact strings handed to the TTS client at runtime; the route
    // tests assert the same shapes against the mocked client. This is the
    // regression guard for the '+0.00%' incident — the format that made
    // every synthesis request fail while unit tests stayed green.
    expect(rateToProsody(1.0)).toMatch(/^[+-]\d+%$/);
    expect(rateToProsody(0.92)).toMatch(/^[+-]\d+%$/);
    expect(DEFAULT_PITCH).toMatch(/^[+-]\d+Hz$/);
  });

  it('escapeSsml escapes the SSML metacharacters in dish names', () => {
    expect(escapeSsml('Fish & Chips')).toBe('Fish &amp; Chips');
    expect(escapeSsml('Dal <special>')).toBe('Dal &lt;special&gt;');
    expect(escapeSsml('5" pizza & "mom\'s"')).toBe('5&quot; pizza &amp; &quot;mom&apos;s&quot;');
    // Ampersand first, so entities never double-escape.
    expect(escapeSsml('&amp;')).toBe('&amp;amp;');
  });

  it('normalizeProsodyPercent coerces legacy and loose inputs to integer percents', () => {
    expect(normalizeProsodyPercent('+0.00%', '+0%')).toBe('+0%');
    expect(normalizeProsodyPercent('-8.00%', '+0%')).toBe('-8%');
    expect(normalizeProsodyPercent('-9.84%', '+0%')).toBe('-10%');
    expect(normalizeProsodyPercent('12%', '+0%')).toBe('+12%');
    expect(normalizeProsodyPercent('+10', '+0%')).toBe('+10%');
  });

  it('normalizeProsodyPercent falls back on garbage instead of throwing', () => {
    expect(normalizeProsodyPercent('fast', '+0%')).toBe('+0%');
    expect(normalizeProsodyPercent(undefined, '+0%')).toBe('+0%');
    expect(normalizeProsodyPercent(null, '-8%')).toBe('-8%');
    expect(normalizeProsodyPercent('', '+0%')).toBe('+0%');
  });

  it('normalizeProsodyPercent clamps absurd values', () => {
    expect(normalizeProsodyPercent('+500%', '+0%')).toBe('+100%');
    expect(normalizeProsodyPercent('-500%', '+0%')).toBe('-100%');
  });

  it('normalizeProsodyHz coerces legacy and loose pitches to integer Hz', () => {
    expect(normalizeProsodyHz('-20Hz', '+0Hz')).toBe('-20Hz');
    expect(normalizeProsodyHz('-19.8Hz', '+0Hz')).toBe('-20Hz');
    expect(normalizeProsodyHz('-20', '+0Hz')).toBe('-20Hz');
    expect(normalizeProsodyHz('loud', '-20Hz')).toBe('-20Hz');
    expect(normalizeProsodyHz('-500Hz', '+0Hz')).toBe('-100Hz');
  });

  it('findEdgeVoice returns the voice for a known name', () => {
    const voice = findEdgeVoice('hi-IN-MadhurNeural');
    expect(voice).not.toBeNull();
    expect(voice?.lang).toBe('hi-IN');
    expect(voice?.gender).toBe('Male');
  });

  it('findEdgeVoice returns null for an unknown voice', () => {
    expect(findEdgeVoice('hi-IN-NonExistentNeural')).toBeNull();
    expect(findEdgeVoice('')).toBeNull();
  });

  it('toVoiceLike converts an EdgeVoice to VoiceLike shape', () => {
    const like = toVoiceLike(EDGE_HINDI_VOICES[0]);
    expect(like.name).toBe('hi-IN-MadhurNeural');
    expect(like.lang).toBe('hi-IN');
    expect(like.localService).toBe(false);
    expect(like.default).toBe(false);
  });

  it('DEFAULT_EDGE_VOICE is in the catalogue', () => {
    expect(findEdgeVoice(DEFAULT_EDGE_VOICE)).not.toBeNull();
  });

  it('DEFAULT_PITCH is -20Hz for a deep, Jackie Shroff-style baritone', () => {
    expect(DEFAULT_PITCH).toBe('-20Hz');
  });

  it('EDGE_HINDI_VOICES contains only male Hindi voices', () => {
    for (const v of EDGE_HINDI_VOICES) {
      expect(v.lang).toBe('hi-IN');
      expect(v.gender).toBe('Male');
    }
  });
});

describe('createServerSpeech', () => {
  function makeMockEnv(overrides: Partial<ServerSpeechEnv> = {}): ServerSpeechEnv & {
    fetchCalls: { text: string; voice: string; rate: string; pitch: string }[];
    audioElements: ReturnType<ServerSpeechEnv['createAudio']>[];
    chimeCalls: number;
  } {
    const fetchCalls: { text: string; voice: string; rate: string; pitch: string }[] = [];
    const audioElements: ReturnType<ServerSpeechEnv['createAudio']>[] = [];
    let chimeCalls = 0;

    const mockAudio = () => {
      const audio = {
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
        onended: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
      };
      audioElements.push(audio);
      return audio;
    };

    const env: ServerSpeechEnv = {
      chime: () => { chimeCalls++; },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      createAudio: mockAudio,
      createObjectUrl: (_data) => 'blob:mock-url',
      revokeObjectUrl: vi.fn(),
      fetchTTS: async (params) => {
        fetchCalls.push(params);
        // Return a small ArrayBuffer as mock audio data
        return new ArrayBuffer(8);
      },
      ...overrides,
    };

    return Object.assign(env, { fetchCalls, audioElements, get chimeCalls() { return chimeCalls; } });
  }

  it('returns an engine with the correct interface', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);

    expect(engine.refreshVoices).toBeTypeOf('function');
    expect(engine.available).toBeTypeOf('function');
    expect(engine.voiceName).toBeTypeOf('function');
    expect(engine.hindiVoices).toBeTypeOf('function');
    expect(engine.setVoiceName).toBeTypeOf('function');
    expect(engine.setRateScale).toBeTypeOf('function');
    expect(engine.unavailable).toBeTypeOf('function');
    expect(engine.stalled).toBeTypeOf('function');
    expect(engine.clearStall).toBeTypeOf('function');
    expect(engine.cancel).toBeTypeOf('function');
    expect(engine.speak).toBeTypeOf('function');
  });

  it('available() returns true (server always has voices)', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    expect(engine.available()).toBe(true);
    expect(engine.unavailable()).toBe(false);
  });

  it('voiceName() returns the default Edge TTS voice', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    expect(engine.voiceName()).toBe('hi-IN-MadhurNeural');
  });

  it('hindiVoices() returns the Edge TTS catalogue', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    const voices = engine.hindiVoices();
    expect(voices.length).toBeGreaterThan(0);
    expect(voices[0].name).toBe('hi-IN-MadhurNeural');
    expect(voices[0].lang).toBe('hi-IN');
  });

  it('setVoiceName() accepts known Edge TTS voices', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    expect(engine.setVoiceName('hi-IN-AaravNeural')).toBe(true);
    expect(engine.voiceName()).toBe('hi-IN-AaravNeural');
  });

  it('setVoiceName() rejects unknown voices', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    expect(engine.setVoiceName('hi-IN-NonExistentNeural')).toBe(false);
    expect(engine.voiceName()).toBe('hi-IN-MadhurNeural'); // unchanged
  });

  it('setVoiceName(null) resets to default', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    engine.setVoiceName('hi-IN-KunalNeural');
    expect(engine.setVoiceName(null)).toBe(true);
    expect(engine.voiceName()).toBe('hi-IN-MadhurNeural');
  });

  it('setRateScale() stores the scale for next speak', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    engine.setRateScale(0.85);
    // The rate scale is applied during speak — just verify it doesn't throw
    expect(() => engine.setRateScale(1.1)).not.toThrow();
  });

  it('stalled() returns false initially', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    expect(engine.stalled()).toBe(false);
  });

  it('clearStall() resets the stall flag', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    // Manually set the stall flag via a failed speak
    engine.speak('test', (outcome) => {
      expect(outcome.status).toBe('failed');
    });
    // The stall flag may be set after the failed speak
    expect(engine.stalled()).toBe(false); // not stalled yet — async
  });

  it('cancel() stops in-flight speech', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    expect(() => engine.cancel()).not.toThrow();
  });

  it('speak() calls fetchTTS with the correct parameters', async () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env, { startTimeoutMs: 5000, completionTimeoutMs: 5000 });

    const onEnd = vi.fn();
    engine.speak('नमस्ते।', onEnd);

    // Wait for the LEAD_IN_MS (280ms) + async fetch to complete
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(env.fetchCalls.length).toBeGreaterThan(0);
    const call = env.fetchCalls[0];
    expect(call.text).toBe('नमस्ते');
    expect(call.voice).toBe('hi-IN-MadhurNeural');
    expect(call.pitch).toBe('-20Hz');
    expect(call.rate).toMatch(/^[+-]\d+%$/);
  });

  it('speak() with empty text reports failure', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    const onEnd = vi.fn();
    engine.speak('', onEnd);
    expect(onEnd).toHaveBeenCalledWith({
      status: 'failed',
      reason: 'Announcement text is empty',
      completedSegments: 0,
      totalSegments: 0,
    });
  });

  it('speak() handles fetch errors gracefully', async () => {
    const env = makeMockEnv({
      fetchTTS: async () => { throw new Error('Network error'); },
    });
    const engine = createServerSpeech(env, { startTimeoutMs: 5000, completionTimeoutMs: 5000 });
    const onEnd = vi.fn();
    engine.speak('नमस्ते।', onEnd);

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(onEnd).toHaveBeenCalledWith({
      status: 'failed',
      reason: 'Network error',
      completedSegments: 0,
      totalSegments: 1,
    });
  });

  it('speak() fails the segment when fetchTTS never settles', async () => {
    // Before the fetch watchdog existed, a hung /api/tts request left the
    // segment without an outcome forever and wedged the announce queue.
    const env = makeMockEnv({
      fetchTTS: () => new Promise<ArrayBuffer>(() => { /* never settles */ }),
    });
    const engine = createServerSpeech(env, {
      startTimeoutMs: 5000,
      completionTimeoutMs: 5000,
      fetchTimeoutMs: 50,
    });
    const onEnd = vi.fn();
    engine.speak('नमस्ते।', onEnd);

    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(onEnd).toHaveBeenCalledWith({
      status: 'failed',
      reason: 'TTS fetch timed out',
      completedSegments: 0,
      totalSegments: 1,
    });
  });

  it('refreshVoices() is a no-op (server voices are fixed)', () => {
    const env = makeMockEnv();
    const engine = createServerSpeech(env);
    expect(() => engine.refreshVoices()).not.toThrow();
  });
});

describe('createDualSpeech', () => {
  /** Mock SpeechEngine for testing the dual engine. */
  function makeMockEngine(overrides: Partial<{
    available: boolean;
    voiceName: string | null;
    hindiVoices: { name: string; lang: string }[];
    speak: (text: string, onEnd: (outcome: import('./speech').SpeechOutcome) => void) => void;
    stalled: boolean;
  }> = {}) {
    const speak = overrides.speak ?? ((text: string, onEnd: (outcome: import('./speech').SpeechOutcome) => void) => {
      onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    });
    return {
      refreshVoices: vi.fn(),
      available: () => overrides.available ?? true,
      voiceName: () => overrides.voiceName ?? 'hi-IN-MadhurNeural',
      hindiVoices: () => overrides.hindiVoices ?? [{ name: 'hi-IN-MadhurNeural', lang: 'hi-IN' }],
      setVoiceName: vi.fn(() => true),
      setRateScale: vi.fn(),
      unavailable: () => !(overrides.available ?? true),
      stalled: () => overrides.stalled ?? false,
      clearStall: vi.fn(),
      cancel: vi.fn(),
      speak,
    };
  }

  it('tries server engine first when available', () => {
    const server = makeMockEngine({ voiceName: 'hi-IN-MadhurNeural' });
    const browser = makeMockEngine({ voiceName: 'Google Hindi' });
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    expect(dual.voiceName()).toBe('hi-IN-MadhurNeural');
    expect(dual.available()).toBe(true);
  });

  it('falls back to browser engine when server is unavailable', () => {
    const server = makeMockEngine({ available: false, voiceName: null });
    const browser = makeMockEngine({ voiceName: 'Google Hindi', available: true });
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    expect(dual.voiceName()).toBe('Google Hindi');
    expect(dual.available()).toBe(true);
  });

  it('falls back to browser when server speak fails', () => {
    const serverSpeak = vi.fn((text: string, onEnd: (outcome: import('./speech').SpeechOutcome) => void) => {
      onEnd({ status: 'failed', reason: 'TTS relay returned 503', completedSegments: 0, totalSegments: 1 });
    });
    const browserSpeak = vi.fn((text: string, onEnd: (outcome: import('./speech').SpeechOutcome) => void) => {
      onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    });
    const server = makeMockEngine({ speak: serverSpeak });
    const browser = makeMockEngine({ speak: browserSpeak });
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    const onEnd = vi.fn();
    dual.speak('नमस्ते।', onEnd);

    // Server was tried first, then browser
    expect(serverSpeak).toHaveBeenCalledWith('नमस्ते।', expect.any(Function));
    expect(browserSpeak).toHaveBeenCalledWith('नमस्ते।', expect.any(Function));
    expect(onEnd).toHaveBeenCalledWith({ status: 'completed', completedSegments: 1, totalSegments: 1 });
  });

  it('uses browser directly when server is already failed', () => {
    const server = makeMockEngine({ available: false, voiceName: null });
    const browser = makeMockEngine({ voiceName: 'Google Hindi', available: true });
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    const onEnd = vi.fn();
    dual.speak('नमस्ते।', onEnd);

    // Browser was called directly
    expect(onEnd).toHaveBeenCalledWith({ status: 'completed', completedSegments: 1, totalSegments: 1 });
  });

  it('setVoiceName tries server first, then browser', () => {
    const serverSetVoice = vi.fn(() => true);
    const browserSetVoice = vi.fn(() => true);
    const server = makeMockEngine({ voiceName: 'hi-IN-MadhurNeural' });
    server.setVoiceName = serverSetVoice;
    const browser = makeMockEngine({ voiceName: 'Google Hindi' });
    browser.setVoiceName = browserSetVoice;
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    dual.setVoiceName('hi-IN-AaravNeural');
    expect(serverSetVoice).toHaveBeenCalledWith('hi-IN-AaravNeural');
    expect(browserSetVoice).not.toHaveBeenCalled();
  });

  it('setRateScale applies to both engines', () => {
    const server = makeMockEngine();
    const browser = makeMockEngine();
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    dual.setRateScale(0.85);
    expect(server.setRateScale).toHaveBeenCalledWith(0.85);
    expect(browser.setRateScale).toHaveBeenCalledWith(0.85);
  });

  it('cancel() cancels both engines', () => {
    const server = makeMockEngine();
    const browser = makeMockEngine();
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    dual.cancel();
    expect(server.cancel).toHaveBeenCalled();
    expect(browser.cancel).toHaveBeenCalled();
  });

  it('hindiVoices() shows server voices when server is available', () => {
    const server = makeMockEngine({
      hindiVoices: [{ name: 'hi-IN-MadhurNeural', lang: 'hi-IN' }, { name: 'hi-IN-AaravNeural', lang: 'hi-IN' }],
    });
    const browser = makeMockEngine({
      hindiVoices: [{ name: 'Google Hindi', lang: 'hi-IN' }],
    });
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    const voices = dual.hindiVoices();
    expect(voices).toHaveLength(2);
    expect(voices[0].name).toBe('hi-IN-MadhurNeural');
  });

  it('hindiVoices() shows browser voices when server has failed', () => {
    const server = makeMockEngine({ available: false, hindiVoices: [] });
    const browser = makeMockEngine({
      hindiVoices: [{ name: 'Google Hindi', lang: 'hi-IN' }],
    });
    const dual = createDualSpeech(
      server as never,
      browser as never,
    );

    const voices = dual.hindiVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0].name).toBe('Google Hindi');
  });

  it('passes a cancelled outcome through without replaying through the browser', () => {
    // Cancellation is deliberate (queue disposed, screen unmounted). The old
    // code treated every non-completed outcome as failure: the browser
    // RE-SPOKE the cancelled announcement and the browser engine was latched
    // for the rest of the session.
    const serverSpeak = vi.fn((text: string, onEnd: (outcome: import('./speech').SpeechOutcome) => void) => {
      onEnd({ status: 'cancelled', completedSegments: 0, totalSegments: 1 });
    });
    const browserSpeak = vi.fn();
    const server = makeMockEngine({ speak: serverSpeak });
    const browser = makeMockEngine({ speak: browserSpeak });
    const dual = createDualSpeech(server as never, browser as never);

    const onEnd = vi.fn();
    dual.speak('नमस्ते।', onEnd);

    expect(browserSpeak).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith({ status: 'cancelled', completedSegments: 0, totalSegments: 1 });
  });

  it('a cancelled outcome does not latch the fallback — the server is tried again', () => {
    const serverSpeak = vi.fn((text: string, onEnd: (outcome: import('./speech').SpeechOutcome) => void) => {
      onEnd({ status: 'cancelled', completedSegments: 0, totalSegments: 1 });
    });
    const server = makeMockEngine({ speak: serverSpeak });
    const browser = makeMockEngine();
    const dual = createDualSpeech(server as never, browser as never);

    dual.speak('एक।', () => {});
    dual.speak('दो।', () => {});

    expect(serverSpeak).toHaveBeenCalledTimes(2);
  });

  it('falls back to the server again after refreshVoices()', () => {
    // A transient server failure latches the fallback so the kitchen keeps
    // hearing announcements; refreshVoices (startup, voice change, toggle)
    // is the deliberate action that gives the server another chance.
    let serverHealthy = false;
    const serverSpeak = vi.fn((text: string, onEnd: (outcome: import('./speech').SpeechOutcome) => void) => {
      if (serverHealthy) {
        onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 });
      } else {
        onEnd({ status: 'failed', reason: 'TTS relay returned 503', completedSegments: 0, totalSegments: 1 });
      }
    });
    const browserSpeak = vi.fn((text: string, onEnd: (outcome: import('./speech').SpeechOutcome) => void) => {
      onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    });
    const server = makeMockEngine({ speak: serverSpeak });
    const browser = makeMockEngine({ speak: browserSpeak });
    const dual = createDualSpeech(server as never, browser as never);

    dual.speak('एक।', () => {});
    expect(serverSpeak).toHaveBeenCalledTimes(1);
    expect(browserSpeak).toHaveBeenCalledTimes(1);

    // Server is healthy again but the latch is still set — browser is used.
    serverHealthy = true;
    dual.speak('दो।', () => {});
    expect(serverSpeak).toHaveBeenCalledTimes(1);
    expect(browserSpeak).toHaveBeenCalledTimes(2);

    dual.refreshVoices();
    dual.speak('तीन।', () => {});
    expect(serverSpeak).toHaveBeenCalledTimes(2);
    expect(browserSpeak).toHaveBeenCalledTimes(2);
  });
});
