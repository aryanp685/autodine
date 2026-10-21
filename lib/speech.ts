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
  /** The pause between sentences. Long enough to write a dish down. */
  gapMs?: number;
};

export type SpeechEngine = {
  /** Speak one announcement. Calls onEnd exactly once. */
  speak(text: string, onEnd: () => void): void;
  /** Re-read the installed voices. Cheap; safe to call on every render. */
  refreshVoices(): void;
  /** Whether this device has a Hindi voice. The only question that matters. */
  available(): boolean;
  /** The name of the Hindi voice that will be used, or null. */
  voiceName(): string | null;
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

/**
 * Speed and pitch.
 *
 * Hindi voices ship fast and flat -- the same engine that reads a market price
 * will read a ticket like an automated phone menu. Pulling the rate down a
 * little and keeping the pitch neutral is the difference between a person
 * telling the pass what to cook and a device reciting a list.
 */
export const VOICE_TUNING = { rate: 0.92, pitch: 1, volume: 1 } as const;

/** A short pause between sentences, in milliseconds. */
export const DEFAULT_GAP_MS = 150;

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
  options: { startTimeoutMs?: number; gapMs?: number } = {},
): SpeechEngine {
  let voices: VoiceLike[] = [];
  let loaded = false;
  let didStall = false;

  const startTimeoutMs = options.startTimeoutMs ?? env.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const gapMs = options.gapMs ?? env.gapMs ?? DEFAULT_GAP_MS;

  function refreshVoices(): void {
    if (!env.synthesis) return;
    const next = env.synthesis.getVoices();
    if (next.length === 0) return; // not enumerated yet; keep the empty list
    voices = next;
    loaded = true;
  }

  refreshVoices();

  function voice(): VoiceLike | null {
    // Voices load asynchronously on most platforms; the first announcement
    // after a cold start is exactly when that matters.
    if (!loaded) refreshVoices();
    return pickHindiVoice(voices);
  }

  return {
    speak(text, onEnd) {
      const body = text.trim();
      const synthesis = env.synthesis;
      const voiceToUse = voice();

      if (!synthesis || !body || !voiceToUse) {
        // No sound is possible. Nothing is spoken, and the queue still has to
        // move: a stuck queue is a board that goes silent for the rest of the
        // service. The caller surfaces why -- see unavailable().
        onEnd();
        return;
      }

      // The chime is played before the voice and outside the watchdog: it is
      // the fallback for a device whose TTS is dead, and it tells the room to
      // listen before the first word rather than after it.
      try {
        env.chime();
      } catch {
        /* audio locked or absent -- the screen still updates */
      }

      const sentences = splitSentences(body);

      let finished = false;
      const finish = () => {
        // An utterance can fire onstart, onend AND onerror on some engines.
        // Calling back twice would run two announcements at once.
        if (finished) return;
        finished = true;
        onEnd();
      };

      const speakAt = (index: number) => {
        if (finished) return;

        const sentence = sentences[index];
        if (!sentence) {
          finish();
          return;
        }

        let settled = false;
        let watchdog: unknown = null;

        const next = () => {
          if (settled) return;
          settled = true;
          env.clearTimer(watchdog);

          if (index + 1 >= sentences.length) {
            finish();
            return;
          }

          // The gap is what makes it sound like a person rather than a list.
          env.setTimer(() => speakAt(index + 1), gapMs);
        };

        try {
          const utterance = env.createUtterance(sentence);
          utterance.voice = voiceToUse;
          utterance.lang = voiceToUse.lang || HINDI_LANGS[0];
          utterance.rate = VOICE_TUNING.rate;
          utterance.pitch = VOICE_TUNING.pitch;
          utterance.volume = VOICE_TUNING.volume;

          utterance.onstart = () => {
            didStall = false;
            env.clearTimer(watchdog);
          };
          utterance.onend = next;
          utterance.onerror = next;

          watchdog = env.setTimer(() => {
            didStall = true;
            // A wedged utterance blocks the whole synthesiser queue. Clearing
            // it is the only way the next ticket gets spoken at all -- and the
            // rest of THIS announcement is abandoned, because the engine is no
            // longer responding.
            try {
              synthesis.cancel();
            } catch {
              /* nothing to cancel */
            }
            finish();
          }, startTimeoutMs);

          synthesis.speak(utterance);
        } catch {
          env.clearTimer(watchdog);
          finish();
        }
      };

      speakAt(0);
    },

    refreshVoices,

    available: () => voice() !== null,

    voiceName: () => voice()?.name ?? null,

    /**
     * True only when this is definitely broken: no synthesiser at all, or a
     * list of voices that contains no Hindi one.
     *
     * An EMPTY list is not proof of anything -- on most browsers getVoices()
     * is empty for the first few hundred milliseconds while the engine
     * enumerates. Claiming "broken" then would raise a false alarm on a
     * perfectly good tablet, so an empty list reports "no voice yet" through
     * voiceName() === null and the board waits before warning.
     */
    unavailable: () => !env.synthesis || (loaded && pickHindiVoice(voices) === null),

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
