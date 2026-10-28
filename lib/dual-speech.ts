/**
 * Dual kitchen voice: server-first with browser fallback.
 *
 * WHY THIS EXISTS
 *
 * The kitchen voice must never go silent because of a network issue.
 * The dual engine tries the server-backed Edge TTS engine first —
 * which gives a consistent, high-quality neural Hindi voice everywhere
 * — and falls back to the browser Web Speech API when Edge TTS is
 * unreachable. The KitchenScreen cannot tell the difference: it talks
 * to the same SpeechEngine interface either way.
 *
 * The fallback is silent and automatic. If the server engine fails
 * (503 from /api/tts, network error, audio playback blocked), the dual
 * engine retries the same text through the browser engine. The kitchen
 * hears the announcement either way.
 *
 * WHAT IT PRESERVES
 *
 * All existing behaviour: order persistence, missed-announcement
 * recovery, queue handling, tenant isolation, speaker lock, speed
 * control, voice selection. The dual engine is a drop-in replacement
 * for createKitchenSpeech at the KitchenScreen integration point.
 */

import {
  type SpeechEngine,
  type SpeechOutcome,
  type VoiceLike,
} from './speech';

/**
 * Create a dual SpeechEngine that tries `server` first and falls back
 * to `browser` when the server engine fails.
 *
 * The fallback happens per-announcement: if the server engine reports
 * a failed outcome, the dual engine immediately retries the same text
 * through the browser engine. The outcome reported to the caller is
 * the browser engine's outcome, with a note that the server engine
 * was tried first.
 */
export function createDualSpeech(
  server: SpeechEngine,
  browser: SpeechEngine,
): SpeechEngine {
  /** True when the server engine has failed and the browser is in use. */
  let serverFailed = false;

  function refreshVoices(): void {
    // A refresh is a deliberate action (startup, voice change, the kitchen
    // toggle) — give the server engine another chance before falling back.
    serverFailed = false;
    server.refreshVoices();
    browser.refreshVoices();
  }

  function available(): boolean {
    // If the server engine is available, prefer it. Otherwise check the
    // browser engine.
    if (!serverFailed && server.available()) return true;
    return browser.available();
  }

  function voiceName(): string | null {
    if (!serverFailed && server.available()) return server.voiceName();
    return browser.voiceName();
  }

  function hindiVoices(): VoiceLike[] {
    // Show the server voices when available — they are the ones that will
    // actually be used. When the server has failed, show browser voices.
    if (!serverFailed && server.available()) return server.hindiVoices();
    return browser.hindiVoices();
  }

  function setVoiceName(name: string | null): boolean {
    // Try the server engine first. If the name is not in its catalogue,
    // try the browser engine. Both are always informed: the browser engine
    // tracks the chosen character's gender for the fallback even when the
    // name is a server catalogue name the device does not have.
    const serverOk = !serverFailed && server.available() ? server.setVoiceName(name) : false;
    const browserOk = browser.setVoiceName(name);
    return serverOk || browserOk;
  }

  function setRateScale(scale: number): void {
    server.setRateScale(scale);
    browser.setRateScale(scale);
  }

  function unavailable(): boolean {
    if (!serverFailed && server.available()) return false;
    return browser.unavailable();
  }

  function stalled(): boolean {
    if (!serverFailed && server.available()) return server.stalled();
    return browser.stalled();
  }

  function clearStall(): void {
    server.clearStall();
    browser.clearStall();
  }

  function cancel(): void {
    server.cancel();
    browser.cancel();
  }

  function speak(text: string, onEnd: (outcome: SpeechOutcome) => void): void {
    if (!serverFailed && server.available()) {
      server.speak(text, (outcome) => {
        // Only a genuine failure falls back. A 'cancelled' outcome means
        // someone stopped the speech on purpose (the queue disposed, the
        // screen unmounted): replaying it through the browser would announce
        // a cancelled ticket and latch the browser engine for the session.
        if (outcome.status !== 'failed') {
          onEnd(outcome);
          return;
        }
        // Server failed — mark it and retry through the browser engine.
        serverFailed = true;
        browser.speak(text, (browserOutcome) => {
          onEnd(browserOutcome);
        });
      });
      return;
    }

    // Server already failed or unavailable — use browser directly.
    browser.speak(text, onEnd);
  }

  return {
    refreshVoices,
    available,
    voiceName,
    hindiVoices,
    setVoiceName,
    setRateScale,
    unavailable,
    stalled,
    clearStall,
    cancel,
    speak,
  };
}
