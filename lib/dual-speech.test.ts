/**
 * Dual kitchen voice — the failover a wall-mounted tablet depends on.
 *
 * The unit contract: server first, browser fallback per announcement;
 * a 'cancelled' outcome is never replayed; a server failure latches the
 * browser engine for the session until an explicit refresh gives the server
 * another chance.
 */

import { describe, expect, it, vi } from 'vitest';

import { createDualSpeech } from './dual-speech';
import type { SpeechEngine, SpeechOutcome, VoiceLike } from './speech';

const completed: SpeechOutcome = { status: 'completed', completedSegments: 1, totalSegments: 1 };
const failed: SpeechOutcome = { status: 'failed', reason: 'playback blocked', completedSegments: 0, totalSegments: 1 };
const cancelled: SpeechOutcome = { status: 'cancelled', completedSegments: 0, totalSegments: 1 };

function fakeEngine(overrides: Partial<SpeechEngine> = {}) {
  const defaults: SpeechEngine = {
    speak: (_text, onEnd) => onEnd(completed),
    refreshVoices: () => {},
    available: () => true,
    voiceName: () => 'engine-voice',
    hindiVoices: () => [{ name: 'engine-voice', lang: 'hi-IN' }] as VoiceLike[],
    englishVoices: () => [{ name: 'en-voice', lang: 'en-IN' }] as VoiceLike[],
    setTargetFamily: () => {},
    setVoiceName: () => true,
    setRateScale: () => {},
    unavailable: () => false,
    stalled: () => false,
    clearStall: () => {},
    cancel: () => {},
  };
  const merged: Record<string, unknown> = { ...defaults, ...overrides };
  const engine = {} as Record<string, ReturnType<typeof vi.fn>>;
  for (const [key, fn] of Object.entries(merged)) {
    engine[key] = vi.fn(fn as (...args: never[]) => unknown);
  }
  return engine as unknown as SpeechEngine & {
    speak: ReturnType<typeof vi.fn>;
    refreshVoices: ReturnType<typeof vi.fn>;
    setTargetFamily: ReturnType<typeof vi.fn>;
    setVoiceName: ReturnType<typeof vi.fn>;
    setRateScale: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    clearStall: ReturnType<typeof vi.fn>;
    hindiVoices: ReturnType<typeof vi.fn>;
  };
}

describe('createDualSpeech — fallback policy', () => {
  it('uses the server engine and never touches the browser when it completes', () => {
    const server = fakeEngine();
    const browser = fakeEngine();
    const dual = createDualSpeech(server, browser);
    const onEnd = vi.fn();
    dual.speak('तेज़ ऑर्डर', onEnd);
    expect(server.speak).toHaveBeenCalledTimes(1);
    expect(browser.speak).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(completed);
  });

  it('falls back to the browser on a server FAILURE and latches for the session', () => {
    const server = fakeEngine({
      speak: (_text: string, onEnd: (outcome: SpeechOutcome) => void) => onEnd(failed),
    });
    const browser = fakeEngine();
    const dual = createDualSpeech(server, browser);
    const onEnd = vi.fn();
    dual.speak('नया ऑर्डर', onEnd);
    expect(browser.speak).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(completed);
    // Latched: the server is not tried again until an explicit refresh.
    expect(dual.available()).toBe(true); // the browser engine still has a voice
    dual.speak('फिर नया ऑर्डर', vi.fn());
    expect(browser.speak).toHaveBeenCalledTimes(2);
    expect(server.speak).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back on a cancelled outcome — replaying a cancelled ticket is a bug', () => {
    const server = fakeEngine({
      speak: (_text: string, onEnd: (outcome: SpeechOutcome) => void) => onEnd(cancelled),
    });
    const browser = fakeEngine();
    const dual = createDualSpeech(server, browser);
    const onEnd = vi.fn();
    dual.speak('रद्द', onEnd);
    expect(browser.speak).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(cancelled);
    // And the server is NOT latched off — a cancel is not a failure.
    dual.speak('अगला', vi.fn());
    expect(server.speak).toHaveBeenCalledTimes(2);
  });

  it('goes straight to the browser when the server engine reports unavailable', () => {
    const server = fakeEngine({ available: () => false, voiceName: () => 'server-voice' });
    const browser = fakeEngine({ voiceName: () => 'browser-voice' });
    const dual = createDualSpeech(server, browser);
    expect(dual.voiceName()).toBe('browser-voice');
    dual.speak('ऑर्डर', vi.fn());
    expect(server.speak).not.toHaveBeenCalled();
    expect(browser.speak).toHaveBeenCalledTimes(1);
  });

  it('refreshVoices gives the server engine another chance and unlatches', () => {
    const server = fakeEngine({
      speak: (_text: string, onEnd: (outcome: SpeechOutcome) => void) => onEnd(failed),
    });
    const browser = fakeEngine();
    const dual = createDualSpeech(server, browser);
    dual.speak('टेस्ट', vi.fn());
    expect(browser.speak).toHaveBeenCalledTimes(1);
    dual.refreshVoices();
    expect(server.refreshVoices).toHaveBeenCalledTimes(1);
    expect(browser.refreshVoices).toHaveBeenCalledTimes(1);
    dual.speak('टेस्ट २', vi.fn());
    expect(server.speak).toHaveBeenCalledTimes(2);
  });

  it('setVoiceName reports the server result, and informs the browser engine regardless', () => {
    const server = fakeEngine({ setVoiceName: () => false });
    const browser = fakeEngine({ setVoiceName: () => true });
    const dual = createDualSpeech(server, browser);
    expect(dual.setVoiceName('Madhur')).toBe(true); // the browser accepted it
    expect(browser.setVoiceName).toHaveBeenCalledWith('Madhur');
  });

  it('routes family and rate hints to both engines', () => {
    const server = fakeEngine();
    const browser = fakeEngine();
    const dual = createDualSpeech(server, browser);
    dual.setTargetFamily('hi');
    dual.setRateScale(0.92);
    dual.cancel();
    dual.clearStall();
    expect(server.setTargetFamily).toHaveBeenCalledWith('hi');
    expect(browser.setTargetFamily).toHaveBeenCalledWith('hi');
    expect(server.setRateScale).toHaveBeenCalledWith(0.92);
    expect(browser.setRateScale).toHaveBeenCalledWith(0.92);
    expect(server.cancel).toHaveBeenCalledTimes(1);
    expect(browser.cancel).toHaveBeenCalledTimes(1);
    expect(server.clearStall).toHaveBeenCalledTimes(1);
    expect(browser.clearStall).toHaveBeenCalledTimes(1);
  });

  it('hindiVoices reflects the browser catalogue once the server latches off', () => {
    const server = fakeEngine({
      speak: (_text: string, onEnd: (outcome: SpeechOutcome) => void) => onEnd(failed),
      hindiVoices: () => [{ name: 'server-voice', lang: 'hi-IN' }] as VoiceLike[],
    });
    const browser = fakeEngine({
      hindiVoices: () => [{ name: 'browser-voice', lang: 'hi-IN' }] as VoiceLike[],
    });
    const dual = createDualSpeech(server, browser);
    expect(dual.hindiVoices()[0].name).toBe('server-voice');
    dual.speak('टेस्ट', vi.fn());
    expect(dual.hindiVoices()[0].name).toBe('browser-voice');
  });
});
