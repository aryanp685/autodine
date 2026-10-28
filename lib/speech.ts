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
 * Each utterance has watchdogs and outcome reporting. The browser supplies
 * the available Hindi voices; the automatic choice is a metadata heuristic,
 * and actual sound quality must be checked on the target device. Punctuation
 * and sentence boundaries pace a ticket, but cannot make the model expressive.
 */

/** The subset of SpeechSynthesisVoice this module needs. */
export type VoiceLike = {
  name: string;
  lang: string;
  localService?: boolean;
  /** Browser-reported default flag; useful for diagnosis, not quality scoring. */
  default?: boolean;
};

import { DEFAULT_EDGE_VOICE, type Gender, voiceGender } from './tts-voices';

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
 * A metadata-only tie-break within one Hindi language tier.
 *
 * The Web Speech API exposes no pronunciation, gender, warmth or quality
 * signal. Names such as "natural" or a vendor label are only weak hints, not
 * evidence that a voice sounds better. This score makes automatic selection
 * deterministic; it is not a substitute for comparing voices on the actual
 * device. Operators can audition the installed candidates in the kitchen UI.
 *
 * GENDER PREFERENCE
 *
 * The kitchen offers two characters — male (Madhur) and female (Swara) — and
 * the browser fallback should match the one the operator picked. The Web
 * Speech API does not expose gender as a field, so this function infers it
 * from the voice name (see voiceGender in lib/tts-voices.ts): a voice of the
 * target gender is up-ranked, a voice of the other gender is down-ranked, an
 * unknown name gets no gender adjustment. This is preference, not a
 * requirement — if the device only has one Hindi voice, that voice is used
 * whatever its gender, because silence is worse than a mismatch.
 */
export function voiceScore(voice: VoiceLike, target: Gender = 'Male'): number {
  const name = `${voice.name} ${voice.lang}`.toLowerCase();
  let score = 0;

  if (/natural|neural/.test(name)) score += 4;
  if (/google|microsoft|azure/.test(name)) score += 2;
  if (/lekha|kalpana|swara|heera|aditi|ravi|veena|neerja|prabhat|madhur|suresh|hemant/.test(name)) {
    score += 2;
  }
  if (voice.localService) score += 1; // no network round trip before it starts

  // Gender: match the chosen character where the device allows it.
  const gender = voiceGender(voice.name);
  if (gender === target) score += 3;
  else if (gender !== null) score -= 8;

  // A weak label-based down-rank only. These names do not establish how a
  // particular installed voice sounds on this device.
  if (/compact|espeak|festival|eloquence|pico|robot/.test(name)) score -= 5;

  return score;
}

function bestOf(voices: VoiceLike[], target: Gender): VoiceLike {
  return [...voices].sort((a, b) => {
    const byScore = voiceScore(b, target) - voiceScore(a, target);
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
 * worse one that merely shares the language family. Within a tier the target
 * gender wins when the device offers a choice; a lone Hindi voice is taken
 * as it is.
 */
export function pickHindiVoice(voices: VoiceLike[], target: Gender = 'Male'): VoiceLike | null {
  if (voices.length === 0) return null;

  for (const wanted of HINDI_LANGS) {
    const targetLang = normaliseLang(wanted);
    const exact = voices.filter((voice) => normaliseLang(voice.lang) === targetLang);
    if (exact.length > 0) return bestOf(exact, target);
  }

  const family = voices.filter((voice) => normaliseLang(voice.lang).startsWith('hi-'));
  return family.length > 0 ? bestOf(family, target) : null;
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
   * Every Hindi-tagged voice this browser reports. Different engines may
   * sound very different despite sharing a language tag; only listening on
   * this device can establish which one is clearest.
   */
  hindiVoices(): VoiceLike[];
  /**
   * Force a specific Hindi voice, or null to return to the automatic candidate.
   *
   * Returns false when the requested voice is not installed -- a preference
   * saved on another tablet, say -- so the caller can fall back rather than
   * silently speaking in something else.
   */
  setVoiceName(name: string | null): boolean;
  /**
   * Speed multiplier applied to every sentence. 1 is the tuned default.
   *
   * Allows the operator to compare slower, normal, and faster playback.
   * Clamped so a stored value cannot make the board unintelligible.
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
 * Browser Web Speech API tuning.
 *
 * Rate stays at 0.92 — slightly slower than neutral for clarity in a noisy
 * kitchen. Pitch follows the chosen character through browserPitchFor():
 * the Web Speech API does not expose gender, so pitch is the only lever to
 * keep a male fallback voice from sounding thin or a female one from
 * sounding artificially deep. Both stay close to the voice's natural pitch —
 * "natural human tone" means the model is not pushed out of its range.
 */
export const VOICE_TUNING = { rate: 0.92, volume: 1 } as const;

/**
 * Web Speech pitch for a character: a touch of warmth for the male voice,
 * the voice's own pitch for the female one.
 */
export function browserPitchFor(gender: Gender): number {
  return gender === 'Female' ? 1.0 : 0.9;
}

/**
 * Existing delay between the alert tone and first word. Kept unchanged in
 * this iteration; it has not been validated by listening on the kitchen device.
 */
export const LEAD_IN_MS = 280;

/**
 * A sentence, with the pacing it is read at.
 *
 * Web Speech gives rate, one utterance at a time, and the gap we insert
 * between them -- that is the whole palette. So the three kinds of sentence a
 * ticket contains are paced differently, the way a person says them:
 *
 *   greeting   "नया ऑर्डर आया है।"       alert, followed by the table phrase
 *   dish       "दो पनीर टिक्का और एक बटर नान।" grouped in short batches
 *   note       "ध्यान देना, प्याज़ नहीं।" a separate, slower instruction
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

/**
 * The sentence kinds planSpeech recognises, by how they open.
 *
 * Recognises both the plain announcement patterns and the expressive
 * personality openers/labels from lib/voice-personality.ts.
 *
 * NOTE: "ध्याn देना भाई!" (expressive greeting opener) must NOT match the
 * note pattern. The note pattern requires a comma after "ध्याn देना" -- the
 * greeting opener has "भाई" instead.
 */
/**
 * The sentence kinds planSpeech recognises, by how they open.
 *
 * Recognises both the plain announcement patterns and the expressive
 * personality openers/labels from lib/voice-personality.ts.
 *
 * NOTE: "ध्यान देना भाई!" (expressive greeting opener) must NOT match the
 * note pattern. The note pattern requires a comma after "ध्यान देना" -- the
 * greeting opener has "भाई" instead.
 */
export function sentenceKind(sentence: string): keyof typeof PACE {
  // Note: requires comma after "ध्यान दें"/"ध्यान देना" so the greeting
  // opener "ध्यान देना भाई!" does not match. Also matches expressive
  // note labels "और सुनons..." and "और हैन्...".
  if (/^(ध्यान दें[,，]|ध्यान देना[,，]|नोट|और सुनons|और हैन्)/.test(sentence)) return "note";
  // Greeting: plain patterns plus expressive openers and closers.
  if (/^(नया|टेबल|अरेय्यो|सुनो रे|अरे भाई|एक नया|कस्टमर|ऑर्डर सही)/.test(sentence)) return "greeting";
  return "dish";
}

/**
 * Turn an announcement into paced sentences.
 *
 * These boundaries give the browser explicit phrase and pause cues; they do
 * not make a synthetic voice human. Web Speech does not expose word-level
 * emphasis or expressive prosody. The existing timings are retained pending
 * listening tests on the actual target devices, which are unavailable here.
 */
export function planSpeech(text: string): SpeechSegment[] {
  const sentences = splitSentences(text);

  let continuingNote = false;
  return sentences.map((sentence, index) => {
    if (NOTE_START.test(sentence)) {
      continuingNote = true;
    } else if (continuingNote) {
      // A new section (greeting opener or closer) ends the note run.
      // Multi-clause notes have chunks without the NOTE_START cue, so we
      // cannot simply reset on every non-note sentence. Only a sentence
      // that starts a known section breaks the run.
      if (/^(नया|टेबल|अरेय्यो|सुनो रे|अरे भाई|एक नया|कस्टमर|ऑर्डर सही)/.test(sentence)) {
        continuingNote = false;
      }
    }
    const kind = continuingNote ? 'note' : sentenceKind(sentence);
    const pace = PACE[kind];

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
const MAX_NOTE_SEGMENT_CHARS = 100;
/**
 * Matches the cue at the start of a safety-note sentence.
 *
 * Requires a comma after "ध्याn दें" / "ध्याn देना" so the expressive
 * greeting opener "ध्याn देना भाई!" does NOT match. Also matches the
 * expressive note labels "और सुनons" and "और हैन्".
 */
/**
 * Matches the cue at the start of a safety-note sentence.
 *
 * Requires a comma after "ध्यान दें" / "ध्याn देना" so the expressive
 * greeting opener "ध्याn देना भाई!" does NOT match. Also matches the
 * expressive note labels "और सुनons" and "और हैन्".
 */
const NOTE_START = /^(?:ध्यान दें[,，]|ध्यान देना[,，]|नोट[,，]?|और सुनons|और हैन्)\s*/u;

/** Split a long safety note at its written clauses, then at word boundaries. */
function chunkNote(sentence: string): string[] {
  const cue = sentence.match(NOTE_START)?.[0] ?? '';
  const body = sentence.slice(cue.length).trim();
  if (!cue || sentence.length <= MAX_NOTE_SEGMENT_CHARS) return [sentence];

  const clauses = body.split(/(?<=[,;])\s+/u).filter(Boolean);
  const chunks: string[] = [];
  let current = cue;

  for (const clause of clauses) {
    const candidate = current ? `${current} ${clause}` : clause;
    if (current && current !== cue && candidate.length > MAX_NOTE_SEGMENT_CHARS) {
      chunks.push(current.trim());
      current = '';
    }

    if (clause.length <= MAX_NOTE_SEGMENT_CHARS) {
      current = current ? `${current} ${clause}` : clause;
      continue;
    }

    // One unusually long clause may have no punctuation. Split only at spaces;
    // no words are removed or rewritten, and the cue appears only on chunk one.
    const words = clause.match(/\S+\s*/gu) ?? [];
    for (const word of words) {
      if (current && current.length + word.length > MAX_NOTE_SEGMENT_CHARS) {
        chunks.push(current.trim());
        current = '';
      }
      current += word;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [sentence];
}

export function splitSentences(text: string): string[] {
  const pieces = text
    .split(/(?<=[।.!?])\s+/u)
    .map((piece) => piece.trim())
    .filter(Boolean);

  return pieces.length > 0 ? pieces.flatMap(chunkNote) : [text.trim()].filter(Boolean);
}

export function createKitchenSpeech(
  env: SpeechEnv,
  options: { startTimeoutMs?: number; completionTimeoutMs?: number } = {},
): SpeechEngine {
  let voices: VoiceLike[] = [];
  let loaded = false;
  let didStall = false;
  let forced: string | null = null;
  // The character the operator picked (male Madhur or female Swara on the
  // server engine). The fallback matches it where the device allows.
  let targetGender: Gender = voiceGender(DEFAULT_EDGE_VOICE) ?? 'Male';
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
    return pickHindiVoice(voices, targetGender);
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
          utterance.pitch = browserPitchFor(targetGender);
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
      if (name === null) {
        forced = null;
        targetGender = voiceGender(DEFAULT_EDGE_VOICE) ?? 'Male';
        return true;
      }
      // Track the chosen character's gender even when the name is a server
      // catalogue name this device does not have (hi-IN-MadhurNeural and
      // hi-IN-SwaraNeural are Edge names) — the fallback must not answer a
      // female character with a male device voice.
      const gender = voiceGender(name);
      if (gender) targetGender = gender;
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
