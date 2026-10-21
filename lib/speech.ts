/**
 * The kitchen's voice.
 *
 * WHY THIS IS NOT JUST speechSynthesis.speak()
 *
 * On a wall-mounted tablet in a real kitchen, speech fails in five ways that
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
 *   5. The caller asks for Hindi and the device has no Hindi voice. The
 *      synthesiser then reads Devanagari at an English phoneme set, which
 *      produces silence or noise -- and it does it while reporting success.
 *      This one is handled a layer up, by lib/announce.ts choosing a language
 *      the device can actually speak; the engine here only ever reports what
 *      it can do (see available()).
 *
 * So every utterance has a watchdog, a chime before it, a chosen voice rather
 * than whatever the platform defaults to, and a sentence-at-a-time delivery so
 * a long ticket is not read in one breath.
 *
 * WHY A CHIME FIRST, AND WHY SENTENCES
 *
 * A kitchen at service is loud. A sentence that begins at conversational
 * volume is half-missed, so two short tones give the room a beat of warning --
 * and the tone still plays on a device where TTS is broken, which is the
 * difference between a missed ticket and a noticed one.
 *
 * Reading "New order, table T1. One Butter Chicken, Half. Two Butter Naan."
 * as one utterance runs the clauses together at whatever speed the engine
 * picked. Sentence by sentence, with a short gap, is how a person says it, and
 * it gives the pass a moment to write the first dish down before the next one
 * starts.
 */

/** The subset of SpeechSynthesisVoice this module needs. */
export type VoiceLike = {
  name: string;
  lang: string;
  localService?: boolean;
};

/** A language this product can announce in. Mirrors lib/announce.ts. */
export type AnnounceLang = 'hi' | 'en';

/**
 * Languages in order of preference for each announcement language.
 *
 * The dish names on a menu are written the way the restaurant writes them,
 * usually English or English-transliterated Hindi. An Indian English voice
 * pronounces both correctly; a generic en-US voice reads "paneer" as "panner"
 * and "masala" flat. en-IN is not always installed, hence the fallbacks.
 *
 * Hindi has no fallback list on purpose: a Hindi sentence read by an English
 * voice is not a degraded announcement, it is no announcement. If no Hindi
 * voice exists the caller speaks English instead.
 */
export const VOICE_LANGS: Record<AnnounceLang, string[]> = {
  hi: ['hi-IN', 'hi'],
  en: ['en-IN', 'en-GB', 'en-AU', 'en-US', 'en'],
};

function normaliseLang(lang: string): string {
  return lang.replace('_', '-').toLowerCase();
}

/**
 * How pleasant a voice is likely to sound, from its name alone.
 *
 * The Web Speech API exposes no quality field, so this is a heuristic -- but a
 * useful one. Every platform ships several voices per language and the
 * default is frequently the oldest and most robotic: on Windows that is
 * Microsoft David, on macOS it is the compact legacy set. The neural voices
 * are named after what they are, and the Indian-language ones are named after
 * people (Lekha, Kalpana, Swara, Heera, Aditi).
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
  if (/lekha|kalpana|swara|heera|aditi|ravi|veena|samantha|siri|aria|jenny|neerja|prabhat/.test(name)) {
    score += 2;
  }
  if (voice.localService) score += 1; // no network round trip before it starts

  // Legacy / embedded engines. Audibly worse than anything above.
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
 * Choose the best installed voice for one language.
 *
 * Exact language matches for every preference first, then regional fallbacks.
 * Doing both inside one loop would let an en-US voice win the "family" match
 * for 'en-IN' before en-GB -- which is listed ahead of it -- was considered.
 *
 * Returns null when nothing in the list can speak this language. For Hindi
 * that is the signal to fall back to English rather than to try anyway.
 */
export function pickVoice(
  voices: VoiceLike[],
  preferred: string[] = VOICE_LANGS.en,
): VoiceLike | null {
  if (voices.length === 0) return null;

  for (const wanted of preferred) {
    const target = normaliseLang(wanted);
    const exact = voices.filter((v) => normaliseLang(v.lang) === target);
    if (exact.length > 0) return bestOf(exact);
  }

  for (const wanted of preferred) {
    const language = normaliseLang(wanted).split('-')[0];
    const family = voices.filter((v) => normaliseLang(v.lang).startsWith(`${language}-`));
    if (family.length > 0) return bestOf(family);
  }

  return null;
}

/** The voice this engine would use for a language, or null. */
export function pickVoiceFor(voices: VoiceLike[], lang: AnnounceLang): VoiceLike | null {
  return pickVoice(voices, VOICE_LANGS[lang]);
}

/* ------------------------------------------------------------------- engine */

/**
 * The part of SpeechSynthesisUtterance this module touches.
 *
 * Structural rather than the DOM type so the engine can be tested with a
 * plain object.
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
  speak(text: string, onEnd: () => void, lang?: AnnounceLang): void;
  /** Re-read the installed voices. Cheap; safe to call on every render. */
  refreshVoices(): void;
  /** Whether this device has a voice for the language. */
  available(lang: AnnounceLang): boolean;
  /** The name of the voice that will be used for a language, or null. */
  voiceName(lang: AnnounceLang): string | null;
  /** True when there is no voice at all for either language. */
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
 * Speed and pitch per language.
 *
 * Hindi voices ship fast and flat -- the same engine that reads a market price
 * will read a ticket like an automated phone menu. Pulling the rate down a
 * little and keeping the pitch neutral is the difference between a person
 * telling the pass what to cook and a device reciting a list.
 *
 * English is left closer to natural speed because the en-IN voices are
 * already well paced.
 */
export const VOICE_TUNING: Record<AnnounceLang, { rate: number; pitch: number; volume: number }> = {
  hi: { rate: 0.92, pitch: 1, volume: 1 },
  en: { rate: 0.97, pitch: 1, volume: 1 },
};

/** A short pause between sentences, in milliseconds. */
export const DEFAULT_GAP_MS = 150;

/**
 * Split an announcement into sentences.
 *
 * Both full stops are recognised: the Latin one and the Devanagari danda, so
 * a Hindi announcement segments the same way an English one does. A piece with
 * no terminal punctuation is still one sentence and is spoken as-is.
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

  function voiceFor(lang: AnnounceLang): VoiceLike | null {
    // Voices load asynchronously on most platforms; the first announcement
    // after a cold start is exactly when that matters.
    if (!loaded) refreshVoices();
    return pickVoiceFor(voices, lang);
  }

  return {
    speak(text, onEnd, lang = 'en') {
      const body = text.trim();
      const synthesis = env.synthesis;
      const voice = voiceFor(lang);

      if (!synthesis || !body || !voice) {
        // No sound is possible. The queue still has to move: a stuck queue is
        // a board that goes silent for the rest of the service.
        onEnd();
        return;
      }

      // The chime is played before the voice and outside the watchdog: it is
      // the fallback for a device whose TTS is dead.
      try {
        env.chime();
      } catch {
        /* audio locked or absent -- the screen still updates */
      }

      const tuning = VOICE_TUNING[lang];
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
          utterance.voice = voice;
          utterance.lang = voice.lang || VOICE_LANGS[lang][0];
          utterance.rate = tuning.rate;
          utterance.pitch = tuning.pitch;
          utterance.volume = tuning.volume;

          utterance.onstart = () => {
            didStall = false;
            env.clearTimer(watchdog);
          };
          utterance.onend = next;
          utterance.onerror = next;

          watchdog = env.setTimer(() => {
            didStall = true;
            // A wedged utterance blocks the whole synthesiser queue. Clearing
            // it is the only way the next ticket gets spoken at all -- and
            // the rest of THIS announcement is abandoned, because the engine
            // is no longer responding.
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

    available(lang) {
      return voiceFor(lang) !== null;
    },

    voiceName(lang) {
      return voiceFor(lang)?.name ?? null;
    },

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
    unavailable: () => !env.synthesis || (loaded && !voices.some((v) => /^en(-|$)/i.test(v.lang))),

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
