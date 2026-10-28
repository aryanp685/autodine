/**
 * Server-backed kitchen voice: Edge TTS via the /api/tts relay.
 *
 * WHY THIS EXISTS
 *
 * The browser Web Speech API gives the kitchen whatever voice the OS
 * happens to ship. On a cheap Android tablet that is often espeak-ng
 * reading Devanagari at an English phoneme set — noise that reports
 * success. On a device with a decent voice, the character is still
 * whatever Microsoft or Google shipped, with no control over warmth,
 * depth, or delivery style.
 *
 * Edge TTS exposes Azure-grade neural Hindi voices for free, with no
 * API key. The browser cannot call it directly (the WebSocket handshake
 * requires a header Chrome and Firefox do not allow setting), so the
 * browser fetches MP3 audio from the /api/tts route instead. This
 * module is the client half of that relay: it speaks by fetching and
 * playing audio, not by calling speechSynthesis.
 *
 * WHAT IT PRESERVES
 *
 * It implements the exact same SpeechEngine interface as
 * createKitchenSpeech — speak, refreshVoices, available, voiceName,
 * hindiVoices, setVoiceName, setRateScale, unavailable, stalled,
 * clearStall, cancel. The KitchenScreen does not need to know which
 * engine it is talking to.
 *
 * The dual engine (createDualSpeech) tries this engine first and
 * falls back to the browser engine when Edge TTS is unreachable, so
 * the kitchen never goes silent because of a network issue.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not clone any person's voice. Edge TTS voices are Microsoft's
 * own neural models. Each character keeps its own natural pitch and the
 * brisk kitchen pace comes from rate tuning, but the character comes from
 * the neural model itself, not from parameter tweaks on a generic voice.
 */

import {
  DEFAULT_COMPLETION_TIMEOUT_MS,
  DEFAULT_START_TIMEOUT_MS,
  LEAD_IN_MS,
  VOICE_TUNING,
  splitSentences,
  type SpeechEngine,
  type SpeechOutcome,
  type VoiceLike,
} from './speech';
import {
  DEFAULT_EDGE_VOICE,
  defaultPitchFor,
  EDGE_HINDI_VOICES,
  findEdgeVoice,
  rateToProsody,
  toVoiceLike,
} from './tts-voices';

/** The subset of the browser environment this engine needs. */
export type ServerSpeechEnv = {
  /** Plays two short tones before speech starts. */
  chime: () => void;
  /** Schedules a callback. Returns a timer id. */
  setTimer: (fn: () => void, ms: number) => unknown;
  /** Clears a scheduled timer. */
  clearTimer: (id: unknown) => void;
  /** Creates an Audio element for playing a blob URL. */
  createAudio: (url: string) => {
    play: () => Promise<void>;
    onended: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    pause: () => void;
  };
  /** Creates a blob URL from audio data. */
  createObjectUrl: (data: ArrayBuffer) => string;
  /** Revokes a blob URL. */
  revokeObjectUrl: (url: string) => void;
  /** Fetches TTS audio from the /api/tts endpoint. */
  fetchTTS: (params: {
    text: string;
    voice: string;
    rate: string;
    pitch: string;
  }) => Promise<ArrayBuffer>;
  /** How long an utterance may go without starting before it is treated as stuck. */
  startTimeoutMs?: number;
};

/**
 * How long to wait for /api/tts to answer before giving up on the server
 * engine for this announcement.
 *
 * The start/completion watchdogs only arm once the audio has arrived — a
 * fetch that never settles would wedge the announcement queue with no
 * outcome at all. 15s covers a serverless cold start plus synthesis of a
 * full announcement (one continuous clip now, so synthesis runs a little
 * longer than the old per-sentence calls) with room to spare, and still
 * fails over to the browser engine promptly.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Create a server-backed SpeechEngine that speaks via Edge TTS.
 *
 * The engine fetches one continuous MP3 clip from /api/tts for the whole
 * announcement and plays it through an HTMLAudioElement. It implements the
 * same interface as createKitchenSpeech so the KitchenScreen cannot tell
 * the difference.
 */
export function createServerSpeech(
  env: ServerSpeechEnv,
  options: { startTimeoutMs?: number; completionTimeoutMs?: number; fetchTimeoutMs?: number } = {},
): SpeechEngine {
  let forcedVoice: string | null = null;
  let rateScale = 1;
  let didStall = false;
  let activeAudio: ReturnType<ServerSpeechEnv['createAudio']> | null = null;
  let activeUrl: string | null = null;
  let cancelCurrent: (() => void) | null = null;

  const startTimeoutMs = options.startTimeoutMs ?? env.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const completionTimeoutMs = options.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  function voiceName(): string {
    if (forcedVoice) return forcedVoice;
    return DEFAULT_EDGE_VOICE;
  }

  function hindiVoices(): VoiceLike[] {
    return EDGE_HINDI_VOICES.map(toVoiceLike);
  }

  function setVoiceName(name: string | null): boolean {
    if (name === null) {
      forcedVoice = null;
      return true;
    }
    const edge = findEdgeVoice(name);
    if (!edge) return false; // not in the Edge TTS catalogue
    forcedVoice = name;
    return true;
  }

  function setRateScale(scale: number): void {
    rateScale = scale;
  }

  function available(): boolean {
    // The server engine always has voices — they come from Edge TTS,
    // not from the device. Availability is determined at speak time.
    return true;
  }

  function unavailable(): boolean {
    return false;
  }

  function stalled(): boolean {
    return didStall;
  }

  function clearStall(): void {
    didStall = false;
  }

  function cancel(): void {
    if (cancelCurrent) {
      cancelCurrent();
      cancelCurrent = null;
    }
  }

  function speak(text: string, onEnd: (outcome: SpeechOutcome) => void): void {
    const body = text.trim();
    const sentences = splitSentences(body);
    // One clip, no partial progress: a cancel or failure reports 0
    // completed rather than guessing how far the voice got.
    const completedSegments = 0;
    let settled = false;
    const timers = new Set<unknown>();

    const schedule = (fn: () => void, ms: number) => {
      const timer = env.setTimer(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
      return timer;
    };

    const clearTimers = () => {
      for (const timer of timers) env.clearTimer(timer);
      timers.clear();
    };

    const finish = (outcome: SpeechOutcome) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (cancelCurrent === cancel) cancelCurrent = null;
      try { onEnd(outcome); } catch { /* observer cannot wedge the synthesiser */ }
    };

    const cancelSpeak = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (activeAudio) {
        try { activeAudio.pause(); } catch { /* best effort */ }
        activeAudio = null;
      }
      if (activeUrl) {
        env.revokeObjectUrl(activeUrl);
        activeUrl = null;
      }
      if (cancelCurrent === cancelSpeak) cancelCurrent = null;
      try { onEnd({ status: 'cancelled', completedSegments, totalSegments: sentences.length }); } catch { /* */ }
    };
    cancelCurrent = cancelSpeak;

    if (!body || sentences.length === 0) {
      finish({
        status: 'failed',
        reason: 'Announcement text is empty',
        completedSegments: 0,
        totalSegments: sentences.length,
      });
      return;
    }

    try { env.chime(); } catch { /* audio can be locked until a gesture */ }

    const edgeVoiceName = voiceName();

    const fail = (reason: string, stalled = false) => {
      if (settled) return;
      if (stalled) didStall = true;
      if (activeAudio) {
        try { activeAudio.pause(); } catch { /* */ }
        activeAudio = null;
      }
      if (activeUrl) {
        env.revokeObjectUrl(activeUrl);
        activeUrl = null;
      }
      finish({ status: 'failed', reason, completedSegments, totalSegments: sentences.length });
    };

    // The whole announcement is synthesized as ONE continuous clip: the
    // sentences follow each other the way a person says them, instead of
    // separate audio files with dead air — and a fresh fetch latency —
    // between every line. That continuity is what makes the voice sound
    // human instead of robotic. Sentences keep their terminators (the
    // danda is a real Hindi full stop and the service pauses on it) — the
    // Read Aloud endpoint rejects SSML nesting, so punctuation is the
    // only pacing tool inside the clip (verified live: nested <prosody>
    // closes the stream; plain text with dandas synthesizes fine).
    const mergedText = sentences
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .join(' ');
    const prosodyRate = rateToProsody(Math.min(1.5, Math.max(0.5, VOICE_TUNING.rate * rateScale)));

    if (!mergedText) {
      finish({ status: 'completed', completedSegments: 0, totalSegments: sentences.length });
      return;
    }

    let clipSettled = false;
    let fetchWatchdog: unknown = null;
    let startWatchdog: unknown = null;
    let completionWatchdog: unknown = null;

    const clearWatchdogs = () => {
      if (fetchWatchdog !== null) { env.clearTimer(fetchWatchdog); timers.delete(fetchWatchdog); fetchWatchdog = null; }
      if (startWatchdog !== null) { env.clearTimer(startWatchdog); timers.delete(startWatchdog); startWatchdog = null; }
      if (completionWatchdog !== null) { env.clearTimer(completionWatchdog); timers.delete(completionWatchdog); completionWatchdog = null; }
    };

    const clipFailure = (reason: string, stalled = false) => {
      if (clipSettled || settled) return;
      clipSettled = true;
      clearWatchdogs();
      fail(reason, stalled);
    };

    const completeClip = () => {
      if (clipSettled || settled) return;
      clipSettled = true;
      clearWatchdogs();
      activeAudio = null;
      if (activeUrl) {
        env.revokeObjectUrl(activeUrl);
        activeUrl = null;
      }
      // One continuous clip carries every planned sentence; a partial
      // count cannot be honest mid-clip, so completion reports them all.
      finish({ status: 'completed', completedSegments: sentences.length, totalSegments: sentences.length });
    };

    // Fetch audio from the /api/tts relay — one request for the whole
    // announcement, started after the chime's breath (the lead-in). The
    // fetch watchdog covers the promise itself: without it a request that
    // never settles would leave the announcement queue waiting forever.
    const run = () => {
      if (settled) return;
      fetchWatchdog = schedule(() => clipFailure('TTS fetch timed out'), fetchTimeoutMs);
      let audioPromise: Promise<ArrayBuffer>;
      try {
        audioPromise = env.fetchTTS({
          text: mergedText,
          voice: edgeVoiceName,
          rate: prosodyRate,
          pitch: defaultPitchFor(edgeVoiceName),
        });
      } catch (error) {
        clipFailure(error instanceof Error ? error.message : 'TTS fetch threw an error');
        return;
      }

      audioPromise.then((audioData) => {
        if (settled || clipSettled) return;
        clearWatchdogs();

        // Create a blob URL and an Audio element.
        const url = env.createObjectUrl(audioData);
        activeUrl = url;
        const audio = env.createAudio(url);
        activeAudio = audio;

        // Set up event handlers.
        audio.onended = () => completeClip();
        audio.onerror = () => {
          clipFailure('Audio playback error');
        };

        // Start watchdog: if play() does not resolve within startTimeoutMs,
        // the audio is treated as stuck.
        startWatchdog = schedule(() => clipFailure('Audio did not start before timeout', true), startTimeoutMs);

        // Completion watchdog: if the audio does not finish within
        // completionTimeoutMs, it is treated as wedged.
        completionWatchdog = schedule(() => clipFailure('Audio did not finish before timeout'), completionTimeoutMs);

        // Play the audio.
        audio.play().then(() => {
          // Play resolved — clear the start watchdog, keep the completion watchdog.
          if (startWatchdog !== null) {
            env.clearTimer(startWatchdog);
            timers.delete(startWatchdog);
            startWatchdog = null;
          }
          didStall = false;
        }).catch((error: unknown) => {
          clipFailure(error instanceof Error ? error.message : 'Audio playback was blocked');
        });
      }).catch((error: unknown) => {
        clipFailure(error instanceof Error ? error.message : 'TTS fetch failed');
      });
    };

    schedule(run, LEAD_IN_MS);
  };

  return {
    refreshVoices: () => { /* server voices are fixed, nothing to refresh */ },
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
