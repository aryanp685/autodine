import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAP_MS,
  HINDI_LANGS,
  VOICE_TUNING,
  createKitchenSpeech,
  pickHindiVoice,
  splitSentences,
  voiceScore,
  type SpeechEnv,
  type UtteranceLike,
  type VoiceLike,
} from './speech';

/**
 * The kitchen voice.
 *
 * These tests are about the failure modes that all look the same from the
 * outside -- silence. On a wall tablet the difference between "the kitchen was
 * told" and "the kitchen was not told" is invisible unless the engine reports
 * it, so what is tested here is the reporting as much as the speaking.
 *
 * The one rule that must never break: Devanagari is only ever handed to a
 * Hindi voice. A device without one is a device that cannot announce, and it
 * is never quietly given an English voice instead.
 */

type FakeUtterance = UtteranceLike & { text: string };

function env(
  options: {
    voices?: VoiceLike[];
    /** Start each utterance immediately, as a working device does. */
    autoStart?: boolean;
    /** Never fire onstart or onend, as Chrome does when it wedges. */
    wedge?: boolean;
    throws?: boolean;
  } = {},
) {
  const spoken: FakeUtterance[] = [];
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let nextId = 1;
  let chimes = 0;
  let cancels = 0;

  // Mutable so a test can make the first utterance wedge and the second work,
  // which is what recovering from a stuck synthesiser looks like.
  let wedge = options.wedge ?? false;
  const autoStart = options.autoStart ?? true;
  let available = options.voices ?? [];

  const speechEnv: SpeechEnv = {
    synthesis: {
      speak(utterance) {
        if (options.throws) throw new Error('no audio device');
        const shaped = utterance as FakeUtterance;
        spoken.push(shaped);

        if (wedge) return;

        if (autoStart) {
          // A healthy engine starts and finishes promptly. Anything the engine
          // schedules for LATER (the gap between sentences, the watchdog) goes
          // through setTimer and is run by flush().
          shaped.onstart?.();
          shaped.onend?.();
        }
      },
      cancel() {
        cancels += 1;
      },
      getVoices: () => available,
      speaking: false,
    },
    createUtterance: (text) => ({
      text,
      voice: null,
      lang: '',
      rate: 1,
      pitch: 1,
      volume: 1,
      onstart: null,
      onend: null,
      onerror: null,
    }),
    chime: () => {
      chimes += 1;
    },
    setTimer(fn, ms) {
      const id = nextId++;
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimer(id) {
      const index = timers.findIndex((t) => t.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    startTimeoutMs: 50,
    gapMs: 0,
  };

  return {
    env: speechEnv,
    spoken,
    timers,
    get chimes() {
      return chimes;
    },
    get cancels() {
      return cancels;
    },
    setWedge(next: boolean) {
      wedge = next;
    },
    setVoices(next: VoiceLike[]) {
      available = next;
    },
    /** Run every pending timer, oldest first, as the event loop would. */
    flush() {
      let guard = 0;
      while (timers.length > 0 && guard < 50) {
        const timer = timers.shift()!;
        timer.fn();
        guard += 1;
      }
    },
  };
}

const english: VoiceLike[] = [
  { name: 'English (United States)', lang: 'en-US', localService: true },
  { name: 'Google UK English Female', lang: 'en-GB', localService: false },
  { name: 'English (India)', lang: 'en-IN', localService: true },
];

const hindi: VoiceLike[] = [
  { name: 'Google हिन्दी', lang: 'hi-IN', localService: false },
  { name: 'Lekha', lang: 'hi-IN', localService: true },
];

describe('pickHindiVoice', () => {
  it('takes a Hindi voice and nothing else', () => {
    expect(pickHindiVoice(english)).toBeNull();
    expect(pickHindiVoice(hindi)?.lang).toBe('hi-IN');
  });

  it('has no English fallback list, on purpose', () => {
    // If this ever grows an "en" entry, a Devanagari sentence can be handed to
    // an English voice -- which reads it as silence and reports success.
    expect(HINDI_LANGS).toEqual(['hi-IN', 'hi']);
  });

  it('accepts a regional Hindi tag rather than giving up', () => {
    expect(pickHindiVoice([{ name: 'Hindi (India)', lang: 'hi-IN' }])?.name).toBe('Hindi (India)');
    expect(pickHindiVoice([{ name: 'Hindi', lang: 'hi' }])?.name).toBe('Hindi');
  });

  it('picks the better of two Hindi voices, not the first enumerated', () => {
    const voices: VoiceLike[] = [
      { name: 'Fred (compact)', lang: 'hi-IN' },
      { name: 'Google हिन्दी', lang: 'hi-IN' },
    ];
    expect(pickHindiVoice(voices)?.name).toBe('Google हिन्दी');
  });

  it('returns null when nothing is installed', () => {
    expect(pickHindiVoice([])).toBeNull();
  });
});

describe('voiceScore', () => {
  it('prefers a natural voice over a legacy one', () => {
    expect(voiceScore({ name: 'Microsoft Swara Online (Natural)', lang: 'hi-IN' })).toBeGreaterThan(
      voiceScore({ name: 'Microsoft Hemant Desktop', lang: 'hi-IN' }),
    );
  });

  it('demotes the audibly robotic engines', () => {
    expect(voiceScore({ name: 'eSpeak Hindi', lang: 'hi-IN' })).toBeLessThan(
      voiceScore({ name: 'Lekha', lang: 'hi-IN' }),
    );
  });
});

describe('splitSentences', () => {
  it('splits on the danda, which is the Hindi full stop', () => {
    expect(splitSentences('नया ऑर्डर, टेबल टी वन। दो बटर नान, आधा।')).toEqual([
      'नया ऑर्डर, टेबल टी वन।',
      'दो बटर नान, आधा।',
    ]);
  });

  it('treats text with no terminator as one sentence rather than none', () => {
    expect(splitSentences('एक बटर चिकन')).toEqual(['एक बटर चिकन']);
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('speaking', () => {
  it('speaks sentence by sentence with a gap between them', () => {
    const fake = env({ voices: hindi });
    const engine = createKitchenSpeech(fake.env);
    let ended = 0;

    engine.speak('नया ऑर्डर, टेबल टी वन। दो बटर नान।', () => {
      ended += 1;
    });

    // First sentence now, the second only after the gap.
    expect(fake.spoken).toHaveLength(1);
    expect(fake.spoken[0].text).toBe('नया ऑर्डर, टेबल टी वन।');

    fake.flush();

    expect(fake.spoken.map((u) => u.text)).toEqual(['नया ऑर्डर, टेबल टी वन।', 'दो बटर नान।']);
    expect(ended).toBe(1);
  });

  it('chimes once before the first word, not once per sentence', () => {
    const fake = env({ voices: hindi });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('एक। दो। तीन।', () => {});
    fake.flush();

    expect(fake.chimes).toBe(1);
    expect(fake.spoken).toHaveLength(3);
  });

  it('uses the Hindi voice and a human rate', () => {
    const fake = env({ voices: [...english, ...hindi] });
    createKitchenSpeech(fake.env).speak('नया ऑर्डर।', () => {});

    expect(fake.spoken[0].voice?.lang).toBe('hi-IN');
    expect(fake.spoken[0].rate).toBe(VOICE_TUNING.rate);
    expect(VOICE_TUNING.rate).toBeLessThan(1);
  });

  it('says nothing at all when the device has no Hindi voice', () => {
    const fake = env({ voices: english });
    const engine = createKitchenSpeech(fake.env);
    let ended = 0;

    engine.speak('नया ऑर्डर, टेबल टी वन।', () => {
      ended += 1;
    });

    // Not one utterance, no chime: the board says why instead of playing a
    // voice that cannot read the sentence.
    expect(fake.spoken).toHaveLength(0);
    expect(fake.chimes).toBe(0);
    // The queue must still move, or every later ticket is stuck behind this.
    expect(ended).toBe(1);
    expect(engine.available()).toBe(false);
  });

  it('reports a device with no synthesiser at all', () => {
    const fake = env({ voices: hindi });
    const engine = createKitchenSpeech({ ...fake.env, synthesis: null });

    expect(engine.unavailable()).toBe(true);
    let ended = 0;
    engine.speak('नया ऑर्डर।', () => {
      ended += 1;
    });
    expect(ended).toBe(1);
  });

  it('does not call a tablet broken just because voices have not loaded yet', () => {
    const fake = env({ voices: [] });
    const engine = createKitchenSpeech(fake.env);

    // An empty list is "not yet", not "never".
    expect(engine.unavailable()).toBe(false);
    expect(engine.voiceName()).toBeNull();

    // ...and it recovers the moment the platform answers.
    fake.setVoices(hindi);
    engine.refreshVoices();
    expect(engine.available()).toBe(true);
    // Lekha is local and named; Google's is remote. Neither is wrong -- what
    // matters is that one is chosen deterministically rather than whichever
    // the platform happened to list first.
    expect(engine.voiceName()).toBe('Lekha');
  });

  it('recovers from a wedged engine instead of dying quietly', () => {
    const fake = env({ voices: hindi, wedge: true });
    const engine = createKitchenSpeech(fake.env);
    let ended = 0;

    engine.speak('नया ऑर्डर, टेबल टी वन।', () => {
      ended += 1;
    });

    fake.flush(); // the watchdog fires

    expect(engine.stalled()).toBe(true);
    expect(fake.cancels).toBe(1); // the wedged utterance is cleared
    expect(ended).toBe(1); // and the queue is released

    // The next ticket is spoken normally.
    fake.setWedge(false);
    engine.speak('दो बटर नान।', () => {});
    expect(fake.spoken.at(-1)?.text).toBe('दो बटर नान।');
  });

  it('survives a synthesiser that throws on speak', () => {
    const fake = env({ voices: hindi, throws: true });
    const engine = createKitchenSpeech(fake.env);
    let ended = 0;

    engine.speak('नया ऑर्डर।', () => {
      ended += 1;
    });

    expect(ended).toBe(1);
  });

  it('does nothing for empty text', () => {
    const fake = env({ voices: hindi });
    let ended = 0;
    createKitchenSpeech(fake.env).speak('   ', () => {
      ended += 1;
    });

    expect(fake.spoken).toHaveLength(0);
    expect(ended).toBe(1);
  });

  it('uses a gap between sentences that a person could write in', () => {
    expect(DEFAULT_GAP_MS).toBeGreaterThanOrEqual(100);
  });
});
