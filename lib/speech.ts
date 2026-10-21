/**
 * The kitchen's voice.
 *
 * WHY THIS IS NOT JUST speechSynthesis.speak()
 *
 * On a wall-mounted tablet in a real kitchen, speech fails in four ways that
 * all look identical from the code: nothing was said.
 *
 *   1. The tab was loaded without a gesture, so the browser silently blocks
 *      audio. Chrome and Safari both do this.
 *   2. There is no installed voice for the language, or voices have not
 *      loaded yet -- `getVoices()` is empty for the first few hundred
 *      milliseconds on most platforms.
 *   3. Chrome wedges: an utterance fires neither `onstart` nor `onend`, and
 *      everything queued behind it is lost for the rest of the service.
 *   4. The device's TTS engine is simply broken (common on cheap Android
 *      tablets).
 *
 * So every utterance here has a watchdog, a chime before it, and a chosen
 * voice rather than whatever the platform defaults to. When speech cannot
 * work, `stalled` goes true and the board says so on screen instead of
 * pretending the kitchen was told.
 *
 * WHY A CHIME FIRST
 *
 * A kitchen at service is loud. A sentence that begins at conversational
 * volume is half-missed. Two short tones give the room a beat of warning, and
 * the tone still plays on a device where TTS is broken -- which is the
 * difference between a missed ticket and a noticed one.
 */

/** The subset of SpeechSynthesisVoice this module needs. */
export type VoiceLike = {
  name: string;
  lang: string;
  localService?: boolean;
};

/**
 * Languages in order of preference for this product.
 *
 * The dish names on a menu are written the way the restaurant writes them,
 * usually English or English-transliterated Hindi. An Indian English voice
 * pronounces both correctly; a generic en-US voice reads "paneer" as
 * "panner" and "masala" flat. en-IN is not always installed, hence the
 * fallbacks rather than a hard requirement.
 */
export const VOICE_LANGS = ['en-IN', 'en-GB', 'en-AU', 'en-US', 'en'];

function normaliseLang(lang: string): string {
  return lang.replace('_', '-').toLowerCase();
}

/**
 * Choose the best installed voice for this product.
 *
 * Exact language match first, then the same language family, then any English
 * voice at all. Within a tier a local voice wins: local voices have no
 * network round trip before they start, which is a whole second on the first
 * announcement of the evening.
 */
export function pickVoice(voices: VoiceLike[], preferred: string[] = VOICE_LANGS): VoiceLike | null {
  if (voices.length === 0) return null;

  // Exact matches for every preferred language FIRST, then regional
  // fallbacks. Doing both inside one loop would let an en-US voice win the
  // "family" match for 'en-IN' before en-GB -- which is listed ahead of it --
  // was ever considered.
  for (const wanted of preferred) {
    const target = normaliseLang(wanted);
    const exact = voices.filter((v) => normaliseLang(v.lang) === target);
    if (exact.length > 0) return [...exact].sort(localFirst)[0];
  }

  for (const wanted of preferred) {
    const language = normaliseLang(wanted).split('-')[0];
    const family = voices.filter((v) => normaliseLang(v.lang).startsWith(`${language}-`));
    if (family.length > 0) return [...family].sort(localFirst)[0];
  }

  return null;
}

function localFirst(a: VoiceLike, b: VoiceLike): number {
  const local = Number(Boolean(b.localService)) - Number(Boolean(a.localService));
  if (local !== 0) return local;
  return a.name.localeCompare(b.name);
}

/* ------------------------------------------------------------------- engine */

/**
 * The part of SpeechSynthesisUtterance this module touches.
 *
 * Structural rather than the DOM type so the engine can be tested with a
 * plain object -- and so the browser adapter can narrow the real event
 * signatures (`(ev: SpeechSynthesisEvent) => any`) to `() => void` in one
 * place instead of here.
 */
export type UtteranceLike = {
  voice: VoiceLike | null;
  lang: string;
  rate: number;
  pitch: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
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

export type KitchenSpeech = {
  /** Speak one sentence. Calls onEnd exactly once. */
  speak(text: string, onEnd: () => void): void;
  /** Re-read the installed voices. Cheap; safe to call on every render. */
  refreshVoices(): void;
  /** The name of the voice that will be used, or null when none exists. */
  voiceName(): string | null;
  /** True when there is no usable voice at all on this device. */
  unavailable(): boolean;
  /** True when an utterance failed to start -- the engine is wedged. */
  stalled(): boolean;
  /** Reset the stall flag after the operator has acknowledged it. */
  clearStall(): void;
  /** Stop anything in flight. Only for teardown, never between announcements. */
  cancel(): void;
};

export const DEFAULT_START_TIMEOUT_MS = 4000;

export function createKitchenSpeech(env: SpeechEnv, preferred: string[] = VOICE_LANGS): KitchenSpeech {
  let voice: VoiceLike | null = null;
  let voicesLoaded = false;
  let didStall = false;

  const startTimeoutMs = env.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;

  function refreshVoices(): void {
    if (!env.synthesis) return;
    const voices = env.synthesis.getVoices();
    if (voices.length === 0) return;

    voicesLoaded = true;

    // Keep the current voice unless it has disappeared -- switching voices
    // between announcements mid-service is disorienting.
    if (voice && voices.some((v) => v.name === voice!.name && v.lang === voice!.lang)) return;
    voice = pickVoice(voices, preferred);
  }

  refreshVoices();

  return {
    speak(text, onEnd) {
      if (!env.synthesis || !text.trim()) {
        onEnd();
        return;
      }

      // Voices load asynchronously on most platforms; the first announcement
      // after a cold start is exactly when that matters.
      if (!voicesLoaded) refreshVoices();

      // The chime is played before the voice and outside the watchdog: it is
      // the fallback for a device whose TTS is dead.
      try {
        env.chime();
      } catch {
        /* audio locked or absent -- the screen still updates */
      }

      let finished = false;
      const finish = () => {
        // An utterance can fire onstart, onend AND onerror on some engines.
        // Calling back twice would run two announcements at once.
        if (finished) return;
        finished = true;
        onEnd();
      };

      let watchdog: unknown = null;
      const armWatchdog = () => {
        watchdog = env.setTimer(() => {
          didStall = true;
          // A wedged utterance blocks the whole synthesiser queue. Clearing
          // it is the only way the next ticket gets spoken at all.
          try {
            env.synthesis?.cancel();
          } catch {
            /* nothing to cancel */
          }
          finish();
        }, startTimeoutMs);
      };

      try {
        const utterance = env.createUtterance(text);
        utterance.voice = voice;
        utterance.lang = voice?.lang ?? preferred[0];
        utterance.rate = 1;
        utterance.pitch = 1;

        utterance.onstart = () => {
          didStall = false;
          env.clearTimer(watchdog);
        };
        utterance.onend = () => {
          env.clearTimer(watchdog);
          finish();
        };
        utterance.onerror = () => {
          env.clearTimer(watchdog);
          finish();
        };

        armWatchdog();
        env.synthesis.speak(utterance);
      } catch {
        env.clearTimer(watchdog);
        finish();
      }
    },
    refreshVoices,
    voiceName: () => voice?.name ?? null,
    /**
     * True only when this is definitely broken: no synthesiser at all, or a
     * list of voices that contains no English one.
     *
     * An EMPTY list is not proof of anything -- on most browsers getVoices()
     * is empty for the first few hundred milliseconds while the engine
     * enumerates. Claiming "broken" then would raise a false alarm on a
     * perfectly good tablet, so an empty list reports "no voice yet" through
     * voiceName() === null and the board waits before warning.
     */
    unavailable: () => !env.synthesis || (voicesLoaded && voice === null),
    stalled: () => didStall,
    clearStall: () => {
      didStall = false;
    },
    cancel() {
      try {
        env.synthesis?.cancel();
      } catch {
        /* nothing to cancel */
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
