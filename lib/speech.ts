/**
 * The kitchen's voice -- one voice, Hindi, never a substitute.
 *
 * WHY THIS IS NOT JUST speechSynthesis.speak()
 *
 * On a wall-mounted tablet in a real kitchen, speech fails in five ways that
 * all look identical from the code: nothing was said.
 *
 *   1. The tab was loaded without a gesture, so the browser silently blocks
 *      audio. Chrome and Safari both do this.
 *   2. There is no installed Hindi voice, or voices have not loaded yet --
 *      `getVoices()` is empty for the first few hundred milliseconds on most
 *      platforms.
 *   3. Chrome wedges: an utterance fires neither `onstart` nor `onend`, and
 *      everything queued behind it is lost for the rest of the service.
 *   4. The device's TTS engine is simply broken (common on cheap Android
 *      tablets).
 *   5. The caller asks for Hindi and the device has no Hindi voice. The
 *      synthesiser then reads Devanagari at an English phoneme set, which
 *      produces silence or noise -- and it does it while reporting success.
 *
 * WHY THERE IS NO ENGLISH FALLBACK HERE
 *
 * This module deliberately has no second language. A Hindi voice is the only
 * voice this product asks for, so `available()` is the whole answer to "can
 * this device announce?" -- and when it is false, nothing is spoken and the
 * board says why, loudly, in words. Quietly switching to English would be a
 * board the kitchen cannot follow while looking exactly like one that works.
 *
 * So every utterance has a watchdog, a chime before it, the best available
 * Hindi voice rather than whatever the platform defaults to, and a
 * sentence-at-a-time delivery so a long ticket is not read in one breath.
 */

/** The subset of SpeechSynthesisVoice this module needs. */
export type VoiceLike = {
  name: string;
  lang: string;
  localService?: boolean;
};

/**
 * Language tags that are Hindi. There is no third entry and no English entry:
 * a Devanagari sentence read by an English voice is silence, not accented
 * Hindi, so an unmatched device is a device that cannot announce.
 */
export const HINDI_LANGS: readonly string[] = ['hi-IN', 'hi'];

function normaliseLang(lang: string): string {
  return lang.replace('_', '-').toLowerCase();
}

/**
 * How pleasant a voice is likely to sound, from its name alone.
 *
 * The Web Speech API exposes no quality field, so this is a heuristic -- but a
 * useful one. Every platform ships several voices per language and the default
 * is frequently the oldest and most robotic: on Windows that is a legacy
 * Microsoft voice, on macOS the compact set, on Android the embedded one. The
 * neural voices are named after what they are, and the Hindi ones are named
 * after people (Lekha, Kalpana, Swara, Heera, Neerja).
 *
 * Higher is better. Ties fall back to local, then alphabetical, so the choice
 * is stable between announcements instead of flickering with enumeration
 * order.
 */
export function voiceScore(voice: VoiceLike): number {
  const name = `${voice.name} ${voice.lang}`.toLowerCase();
  let score = 0;

  if (/natural|neural/.test(name)) score += 4;
  if (/google|microsoft|azure/.test(name)) score += 2;
  if (/lekha|kalpana|swara|heera|aditi|ravi|veena|neerja|prabhat|madhur|suresh/.test(name)) {
    score += 2;
  }
  if (voice.localService) score += 1; // no network round trip before it starts

  // Legacy / embedded engines. Audibly worse than anything above, and some of
  // them skip Devanagari-embedded Latin entirely.
  if (/compact|espeak|festival|eloquence|pico|robot/.test(name)) score -= 5;

  return score;
}

function bestOf(voices: VoiceLike[]): VoiceLike {
  return [...voices].sort((a, b) => {
    const byScore = voiceScore(b) - voiceScore(a);
    if (byScore !== 0) return byScore;
    const byLocal = Number(Boolean(b.localService)) - Number(Boolean(a.localService));
    if (byLocal !== 0) return byLocal;
    return a.name.localeCompare(b.name);
  })[0];
}

/**
 * The Hindi voice this device will use, or null.
 *
 * Exact `hi-IN` first, then any other Hindi tag, then any `hi-*` region. The
 * passes are separate so a `hi-IN` voice is never passed over in favour of a
 * worse one that merely shares the language family.
 */
export function pickHindiVoice(voices: VoiceLike[]): VoiceLike | null {
  if (voices.length === 0) return null;

  for (const wanted of HINDI_LANGS) {
    const target = normaliseLang(wanted);
    const exact = voices.filter((voice) => normaliseLang(voice.lang) === target);
    if (exact.length > 0) return bestOf(exact);
  }

  const family = voices.filter((voice) => normaliseLang(voice.lang).startsWith('hi-'));
  return family.length > 0 ? bestOf(family) : null;
}

/* ------------------------------------------------------------------- engine */

/**
 * The part of SpeechSynthesisUtterance this module touches.
 *
 * Structural rather than the DOM type so the engine can be tested with a plain
 * object.
 */
export type UtteranceLike = {
  voice: VoiceLike | null;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
};

export type SpeechEnv = {
  /** The platform synthesiser, or null where the API does not exist. */
  synthesis: {
    speak(utterance: unknown): void;
    cancel(): void;
    getVoices(): VoiceLike[];
    speaking: boolean;
  } | null;
  /** Builds an utterance for a piece of text. */
  createUtterance: (text: string) => UtteranceLike;
  /** Two short tones. Must be safe to call when audio is locked. */
  chime: () => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
  /** How long an utterance may go without starting before it is treated as stuck. */
  startTimeoutMs?: number;
};

export type SpeechOutcome =
  | { status: 'completed'; completedSegments: number; totalSegments: number }
  | { status: 'failed'; reason: string; completedSegments: number; totalSegments: number }
  | { status: 'cancelled'; completedSegments: number; totalSegments: number };

export type SpeechEngine = {
  /** Speak one announcement and report whether it was actually completed. */
  speak(text: string, onEnd: (outcome: SpeechOutcome) => void): void;
  /** Re-read the installed voices. Cheap; safe to call on every render. */
  refreshVoices(): void;
  /** Whether this device has a Hindi voice. The only question that matters. */
  available(): boolean;
  /** The name of the Hindi voice that will be used, or null. */
  voiceName(): string | null;
  /**
   * Every Hindi voice this device has.
   *
   * A device can carry more than one, and they are not equally good: an
   * embedded engine and a downloaded neural one both answer to hi-IN and
   * sound nothing alike. The board lists them so an operator whose default
   * sounds wrong can try the other one instead of living with it.
   */
  hindiVoices(): VoiceLike[];
  /**
   * Force a specific Hindi voice, or null to go back to the best available.
   *
   * Returns false when the requested voice is not installed -- a preference
   * saved on another tablet, say -- so the caller can fall back rather than
   * silently speaking in something else.
   */
  setVoiceName(name: string | null): boolean;
  /**
   * Speed multiplier applied to every sentence. 1 is the tuned default.
   *
   * A room with an echo, or an operator who finds the default hurried, needs
   * this. Clamped so a stored value cannot make the board unintelligible.
   */
  setRateScale(scale: number): void;
  /** True when there is no Hindi voice at all. */
  unavailable(): boolean;
  /** True when an utterance failed to start -- the engine is wedged. */
  stalled(): boolean;
  /** Reset the stall flag after the operator has acknowledged it. */
  clearStall(): void;
  /** Stop anything in flight. Only for teardown, never between announcements. */
  cancel(): void;
};

export const DEFAULT_START_TIMEOUT_MS = 4000;
export const DEFAULT_COMPLETION_TIMEOUT_MS = 30_000;

/**
 * Speed and pitch.
 *
 * Hindi voices ship fast and flat -- the same engine that reads a market price
 * will read a ticket like an automated phone menu. Pulling the rate down a
 * little and keeping the pitch neutral is the difference between a person
 * telling the pass what to cook and a device reciting a list.
 *
 * This is the BASE rate. Individual sentences are adjusted around it by
 * planSpeech() below, because a person does not read a ticket at one speed.
 */
export const VOICE_TUNING = { rate: 0.92, pitch: 1, volume: 1 } as const;

/**
 * How long the board waits after the chime before the first word.
 *
 * A tone followed instantly by speech sounds like a machine. A person rings a
 * bell and then takes a breath; that breath is the difference between "an
 * alert" and "someone telling you something".
 */
export const LEAD_IN_MS = 280;

/**
 * A sentence, with the pacing it is read at.
 *
 * Web Speech gives rate, one utterance at a time, and the gap we insert
 * between them -- that is the whole palette. So the three kinds of sentence a
 * ticket contains are paced differently, the way a person says them:
 *
 *   greeting   "नया ऑर्डर, टेबल टी वन।"  a little slower, then a real pause,
 *              because the next words are a list the pass has to write down
 *   dish       "एक बटर चिकन, आधा।"      steady, short pause between dishes
 *   note       "ध्यान दें, प्याज़ नहीं।" slower and warned by a longer pause,
 *              because a constraint said at speed is a constraint missed
 */
export type SpeechSegment = {
  text: string;
  /** Multiplier applied to VOICE_TUNING.rate. */
  rate: number;
  /** Silence before this sentence starts. */
  leadMs: number;
  /** Silence after this sentence, before the next one. */
  gapMs: number;
};

const PACE = {
  greeting: { rate: 0.98, leadMs: 0, gapMs: 480 },
  dish: { rate: 1, leadMs: 0, gapMs: 300 },
  note: { rate: 0.94, leadMs: 520, gapMs: 0 },
} as const;

/** The sentence kinds planSpeech recognises, by how they open. */
export function sentenceKind(sentence: string): keyof typeof PACE {
  if (/^(ध्यान दें|नोट)/.test(sentence)) return 'note';
  if (/^(नया|टेबल)/.test(sentence)) return 'greeting';
  return 'dish';
}

/**
 * Turn an announcement into paced sentences.
 *
 * This is where "human" actually lives. Speaking the same words at one rate
 * with one gap, no matter what they mean, is what makes a synthesiser sound
 * like a synthesiser: the voice has no idea that "टेबल टी वन" is a heading and
 * "प्याज़ नहीं" is a warning. Giving each kind its own rate and its own pause
 * costs nothing and is heard immediately in a kitchen.
 */
export function planSpeech(text: string): SpeechSegment[] {
  const sentences = splitSentences(text);

  return sentences.map((sentence, index) => {
    const pace = PACE[sentenceKind(sentence)];

    return {
      text: sentence,
      rate: pace.rate,
      // The lead-in already covers the pause before the first sentence.
      leadMs: index === 0 ? 0 : pace.leadMs,
      // Nothing to wait for after the last sentence.
      gapMs: index === sentences.length - 1 ? 0 : pace.gapMs,
    };
  });
}

/**
 * Split an announcement into sentences.
 *
 * The danda is the Hindi full stop and is what lib/announce.ts ends every
 * clause with. Latin terminators are accepted too, so a message built
 * elsewhere is still paced rather than read in one breath.
 */
export function splitSentences(text: string): string[] {
  const pieces = text
    .split(/(?<=[।.!?])\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  return pieces.length > 0 ? pieces : [text.trim()].filter(Boolean);
}

export function createKitchenSpeech(
  env: SpeechEnv,
  options: { startTimeoutMs?: number; completionTimeoutMs?: number } = {},
): SpeechEngine {
  let voices: VoiceLike[] = [];
  let loaded = false;
  let didStall = false;
  let forced: string | null = null;
  let rateScale = 1;
  let cancelCurrent: (() => void) | null = null;

  const startTimeoutMs = options.startTimeoutMs ?? env.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const completionTimeoutMs = options.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;

  function refreshVoices(): void {
    if (!env.synthesis) return;
    const next = env.synthesis.getVoices();
    if (next.length === 0) return;
    voices = next;
    loaded = true;
    // A previously selected voice may disappear after an OS update or while
    // the browser refreshes its voice catalogue. Never retain a stale choice.
    if (forced && !voices.some((candidate) => candidate.name === forced)) forced = null;
  }

  refreshVoices();

  function voice(): VoiceLike | null {
    if (!loaded) refreshVoices();
    if (forced) {
      const chosen = voices.find((candidate) => candidate.name === forced);
      if (chosen) return chosen;
    }
    return pickHindiVoice(voices);
  }

  return {
    speak(text, onEnd) {
      const body = text.trim();
      const synthesis = env.synthesis;
      const voiceToUse = voice();
      const sentences = splitSentences(body);
      let completedSegments = 0;
      let settled = false;
      const timers = new Set<unknown>();
      let activeUtterance = false;

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
      const cancel = () => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (cancelCurrent === cancel) cancelCurrent = null;
        try { synthesis?.cancel(); } catch { /* best effort */ }
        try { onEnd({ status: 'cancelled', completedSegments, totalSegments: sentences.length }); } catch { /* observer cannot wedge the synthesiser */ }
      };
      cancelCurrent = cancel;

      if (!synthesis || !body || !voiceToUse || sentences.length === 0) {
        finish({
          status: 'failed',
          reason: !synthesis ? 'Speech synthesis is unavailable' : !voiceToUse ? 'No Hindi voice is available' : 'Announcement text is empty',
          completedSegments: 0,
          totalSegments: sentences.length,
        });
        return;
      }

      try { env.chime(); } catch { /* audio can be locked until a gesture */ }
      const plan = planSpeech(body);

      const fail = (reason: string, stalled = false) => {
        if (settled) return;
        if (stalled) didStall = true;
        if (activeUtterance) {
          try { synthesis.cancel(); } catch { /* nothing to cancel */ }
          activeUtterance = false;
        }
        finish({ status: 'failed', reason, completedSegments, totalSegments: sentences.length });
      };

      const speakAt = (index: number) => {
        if (settled) return;
        const raw = sentences[index];
        const segment = plan[index];
        if (!raw || !segment) {
          finish({ status: 'completed', completedSegments, totalSegments: sentences.length });
          return;
        }
        const sentence = raw.replace(/[।.!?\s]+$/u, '').trim();
        if (!sentence) {
          completedSegments += 1;
          if (index + 1 >= sentences.length) finish({ status: 'completed', completedSegments, totalSegments: sentences.length });
          else schedule(() => speakAt(index + 1), 0);
          return;
        }

        let segmentSettled = false;
        let startWatchdog: unknown = null;
        let completionWatchdog: unknown = null;
        const clearWatchdogs = () => {
          if (startWatchdog !== null) { env.clearTimer(startWatchdog); timers.delete(startWatchdog); startWatchdog = null; }
          if (completionWatchdog !== null) { env.clearTimer(completionWatchdog); timers.delete(completionWatchdog); completionWatchdog = null; }
        };
        const segmentFailure = (reason: string, stalled = false) => {
          if (segmentSettled || settled) return;
          segmentSettled = true;
          clearWatchdogs();
          fail(reason, stalled);
        };
        const next = () => {
          if (segmentSettled || settled) return;
          segmentSettled = true;
          activeUtterance = false;
          clearWatchdogs();
          completedSegments += 1;
          if (index + 1 >= sentences.length) {
            finish({ status: 'completed', completedSegments, totalSegments: sentences.length });
            return;
          }
          const nextSegment = plan[index + 1];
          schedule(() => speakAt(index + 1), segment.gapMs + (nextSegment?.leadMs ?? 0));
        };

        try {
          const utterance = env.createUtterance(sentence);
          utterance.voice = voiceToUse;
          utterance.lang = voiceToUse.lang || HINDI_LANGS[0];
          utterance.rate = Math.min(1.5, Math.max(0.5, VOICE_TUNING.rate * segment.rate * rateScale));
          utterance.pitch = VOICE_TUNING.pitch;
          utterance.volume = VOICE_TUNING.volume;
          utterance.onstart = () => {
            didStall = false;
            if (startWatchdog !== null) { env.clearTimer(startWatchdog); timers.delete(startWatchdog); startWatchdog = null; }
            completionWatchdog = schedule(() => segmentFailure('Speech did not finish before timeout'), completionTimeoutMs);
          };
          utterance.onend = next;
          utterance.onerror = (event) => {
            const error = event?.error || 'Speech synthesis error';
            if (error === 'interrupted' || error === 'canceled') {
              segmentFailure('Speech was interrupted');
            } else {
              segmentFailure(`Speech failed: ${error}`);
            }
          };
          activeUtterance = true;
          startWatchdog = schedule(() => segmentFailure('Speech did not start before timeout', true), startTimeoutMs);
          synthesis.speak(utterance);
        } catch (error) {
          segmentFailure(error instanceof Error ? error.message : 'Speech synthesis threw an error');
        }
      };

      schedule(() => speakAt(0), LEAD_IN_MS);
    },

    refreshVoices,
    available: () => voice() !== null,
    voiceName: () => voice()?.name ?? null,
    hindiVoices() {
      if (!loaded) refreshVoices();
      return voices.filter((candidate) => /^hi(-|$)/i.test(candidate.lang.replace('_', '-')));
    },
    setVoiceName(name) {
      if (name === null) { forced = null; return true; }
      if (!loaded) refreshVoices();
      if (!voices.some((candidate) => candidate.name === name && /^hi(-|$)/i.test(candidate.lang.replace('_', '-')))) return false;
      forced = name;
      return true;
    },
    setRateScale(scale) {
      if (!Number.isFinite(scale)) return;
      rateScale = Math.min(1.3, Math.max(0.6, scale));
    },
    unavailable: () => !env.synthesis || (loaded && pickHindiVoice(voices) === null),
    stalled: () => didStall,
    clearStall: () => { didStall = false; },
    cancel() {
      if (cancelCurrent) cancelCurrent();
      else {
        try { env.synthesis?.cancel(); } catch { /* nothing to cancel */ }
      }
    },
  };
}

/* ------------------------------------------------------------ browser wiring */

/**
 * Two short tones through WebAudio, created lazily and resumed on gesture.
 *
 * Wrapped because every browser throws here when the page has not been
 * interacted with yet, and none of that is worth an error in the console of a
 * screen nobody is watching.
 */
export function createChime(): () => void {
  let context: AudioContext | null = null;

  return function chime() {
    if (typeof window === 'undefined') return;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    if (!context) context = new Ctor();
    // A suspended context is what an autoplay policy looks like. resume()
    // only succeeds inside a gesture, so this is best-effort by design.
    if (context.state === 'suspended') void context.resume();

    const now = context.currentTime;

    for (const [index, frequency] of [880, 1174].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = now + index * 0.13;

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.28, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.12);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.14);
    }
  };
}

/** The real browser environment. Split out so the engine stays testable. */
export function browserSpeechEnv(chime: () => void): SpeechEnv {
  const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

  return {
    synthesis: synthesis
      ? {
          speak: (utterance) => synthesis.speak(utterance as SpeechSynthesisUtterance),
          cancel: () => synthesis.cancel(),
          getVoices: () => synthesis.getVoices() as unknown as VoiceLike[],
          get speaking() {
            return synthesis.speaking;
          },
        }
      : null,
    /**
     * The real utterance, viewed through the narrower type above.
     *
     * The DOM handlers are typed `(event) => any` with a `this` binding; this
     * module only needs "started" and "over". A handler that ignores its
     * argument satisfies the DOM type, so assigning our callbacks to it is
     * safe -- it is the reverse direction the compiler objects to, hence a
     * single cast at this boundary rather than a wrapper object.
     */
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    chime,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}
