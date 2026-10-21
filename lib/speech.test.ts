import { describe, expect, it } from 'vitest';
import {
  DEFAULT_START_TIMEOUT_MS,
  VOICE_LANGS,
  VOICE_TUNING,
  createKitchenSpeech,
  pickVoice,
  pickVoiceFor,
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
 * Hindi is the case that bites hardest: a device without a Hindi voice given
 * Devanagari produces nothing at all while the engine reports success.
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

const both: VoiceLike[] = [...english, ...hindi];

describe('pickVoice', () => {
  it('prefers Indian English, which pronounces a menu the way the menu is written', () => {
    expect(pickVoice(english)?.name).toBe('English (India)');
  });

  it('falls back through the list when en-IN is not installed', () => {
    const withoutIndia = english.filter((v) => v.lang !== 'en-IN');
    expect(pickVoice(withoutIndia)?.name).toBe('Google UK English Female');
  });

  it('takes any English voice rather than reading in another language', () => {
    const onlyHindi = [{ name: 'Google हिन्दी', lang: 'hi-IN' }];
    expect(pickVoice(onlyHindi)).toBeNull();
  });

  it('returns null rather than guessing when nothing is installed', () => {
    expect(pickVoice([])).toBeNull();
  });
});

describe('pickVoiceFor', () => {
  it('needs an actual Hindi voice for Hindi, not an English one standing in', () => {
    expect(pickVoiceFor(english, 'hi')).toBeNull();
    expect(pickVoiceFor(both, 'hi')?.lang).toBe('hi-IN');
  });

  it('never picks a Hindi voice to read English text', () => {
    expect(pickVoiceFor(hindi, 'en')).toBeNull();
  });

  it('has no English fallback list for Hindi, on purpose', () => {
    // A Hindi sentence read by an English voice is not a degraded
    // announcement, it is no announcement. The caller switches language.
    expect(VOICE_LANGS.hi).toEqual(['hi-IN', 'hi']);
  });
});

describe('voiceScore', () => {
  it('prefers a named neural voice over a legacy compact one', () => {
    const natural = voiceScore({ name: 'Microsoft Neerja Online (Natural)', lang: 'en-IN' });
    const legacy = voiceScore({ name: 'Microsoft David Desktop', lang: 'en-US' });
    expect(natural).toBeGreaterThan(legacy);
  });

  it('demotes the audibly robotic engines', () => {
    expect(voiceScore({ name: 'eSpeak Hindi', lang: 'hi-IN' })).toBeLessThan(
      voiceScore({ name: 'Lekha', lang: 'hi-IN' }),
    );
  });

  it('picks the better of two Hindi voices, not the first enumerated', () => {
    const voices: VoiceLike[] = [
      { name: 'Fred (compact)', lang: 'hi-IN' },
      { name: 'Google हिन्दी', lang: 'hi-IN' },
    ];
    expect(pickVoiceFor(voices, 'hi')?.name).toBe('Google हिन्दी');
  });
});

describe('splitSentences', () => {
  it('splits an English announcement', () => {
    expect(splitSentences('New order, table T1. One Butter Chicken. Note: no onion.')).toEqual([
      'New order, table T1.',
      'One Butter Chicken.',
      'Note: no onion.',
    ]);
  });

  it('splits on the Devanagari danda too', () => {
    // Without this a Hindi announcement would be one long breathless run.
    expect(splitSentences('नया ऑर्डर, टेबल टी वन। एक koko।')).toEqual([
      'नया ऑर्डर, टेबल टी वन।',
      'एक koko।',
    ]);
  });

  it('keeps a single sentence whole', () => {
    expect(splitSentences('New order, table T1.')).toEqual(['New order, table T1.']);
  });

  it('returns nothing for blank text', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('createKitchenSpeech', () => {
  it('speaks, and reports the voice it chose', () => {
    const fake = env({ voices: both });
    const engine = createKitchenSpeech(fake.env);

    let ended = 0;
    engine.speak('New order, table T1.', () => {
      ended += 1;
    });
    fake.flush();

    expect(fake.spoken[0].text).toBe('New order, table T1.');
    expect(fake.spoken[0].lang).toBe('en-IN');
    expect(ended).toBe(1);
    expect(engine.voiceName('en')).toBe('English (India)');
  });

  it('speaks Hindi at a Hindi voice when one exists', () => {
    const fake = env({ voices: both });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('नया ऑर्डर, टेबल टी वन।', () => {}, 'hi');
    fake.flush();

    expect(fake.spoken[0].lang).toBe('hi-IN');
    // Which of the two installed Hindi voices wins is a quality judgement
    // (see voiceScore); what matters here is that it is one of them and not
    // an English voice trying to read Devanagari.
    expect(['Google हिन्दी', 'Lekha']).toContain(engine.voiceName('hi'));
  });

  it('does not speak Devanagari when the device has no Hindi voice', () => {
    // The failure this prevents: an English synthesiser given Hindi text
    // produces silence while the caller believes the kitchen was told.
    const fake = env({ voices: english });
    const engine = createKitchenSpeech(fake.env);

    expect(engine.available('hi')).toBe(false);

    let ended = 0;
    engine.speak('नया ऑर्डर।', () => {
      ended += 1;
    }, 'hi');

    expect(fake.spoken).toHaveLength(0);
    expect(ended).toBe(1);
  });

  it('reads a ticket sentence by sentence, not in one breath', () => {
    const fake = env({ voices: both });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('नया ऑर्डर, टेबल टी वन। एक koko। नोट: no onion।', () => {}, 'hi');
    fake.flush();

    expect(fake.spoken.map((u) => u.text)).toEqual([
      'नया ऑर्डर, टेबल टी वन।',
      'एक koko।',
      'नोट: no onion।',
    ]);
  });

  it('calls back once, after the last sentence', () => {
    const fake = env({ voices: both });
    const engine = createKitchenSpeech(fake.env);

    let ended = 0;
    engine.speak('One. Two. Three.', () => {
      ended += 1;
    });

    expect(ended).toBe(0);
    fake.flush();
    expect(ended).toBe(1);
  });

  it('slows Hindi down, because those voices ship too fast to follow', () => {
    const fake = env({ voices: both });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('नया ऑर्डर।', () => {}, 'hi');
    fake.flush();

    expect(fake.spoken[0].rate).toBe(VOICE_TUNING.hi.rate);
    expect(fake.spoken[0].rate).toBeLessThan(1);
  });

  it('chimes once per announcement, before the first sentence', () => {
    const fake = env({ voices: both });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('One. Two. Three.', () => {});
    fake.flush();

    expect(fake.chimes).toBe(1);
  });

  it('calls back exactly once when an utterance fires both end and error', () => {
    // Some engines fire onend AND onerror for one utterance. Two callbacks
    // would start the next announcement twice -- the overlap this whole
    // module exists to prevent.
    const fake = env({ voices: both, autoStart: false });
    const engine = createKitchenSpeech(fake.env);

    let ended = 0;
    engine.speak('One sentence.', () => {
      ended += 1;
    });

    const utterance = fake.spoken[0];
    utterance.onend?.();
    utterance.onerror?.();
    utterance.onend?.();

    expect(ended).toBe(1);
  });

  it('recovers from a wedged synthesiser instead of losing the rest of the service', () => {
    // Chrome can fire neither onstart nor onend. Without the watchdog the
    // queue stalls on announcement one and every ticket after it is silent.
    const fake = env({ voices: both, wedge: true });
    const engine = createKitchenSpeech(fake.env);

    let ended = 0;
    engine.speak('One.', () => {
      ended += 1;
    });

    expect(ended).toBe(0);
    expect(fake.timers).toHaveLength(1);

    fake.flush();

    expect(ended).toBe(1);
    expect(engine.stalled()).toBe(true);
    // Freeing the wedged utterance is the only way the next one can play.
    expect(fake.cancels).toBe(1);
  });

  it('clears the stall flag once a later announcement actually starts', () => {
    const fake = env({ voices: both, wedge: true });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('One.', () => {});
    fake.flush();
    expect(engine.stalled()).toBe(true);

    fake.setVoices(both);
    fake.setWedge(false);
    engine.speak('Two.', () => {});
    fake.flush();
    fake.spoken.at(-1)?.onstart?.();

    expect(engine.stalled()).toBe(false);
  });

  it('abandons the rest of a wedged announcement rather than reading it late', () => {
    const fake = env({ voices: both, wedge: true });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('One. Two. Three.', () => {});
    fake.flush();

    // Only the first sentence was ever handed over; the engine is not
    // responding, so the remaining two must not queue behind it.
    expect(fake.spoken).toHaveLength(1);
  });

  it('still ends the queue when the platform has no synthesiser at all', () => {
    const fake = env({ voices: both });
    fake.env.synthesis = null;
    const engine = createKitchenSpeech(fake.env);

    let ended = 0;
    engine.speak('anything', () => {
      ended += 1;
    });

    expect(ended).toBe(1);
    expect(engine.unavailable()).toBe(true);
  });

  it('reports a voice list with no English voice as unusable', () => {
    const fake = env({ voices: hindi });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('anything', () => {});
    expect(engine.unavailable()).toBe(true);
  });

  it('does NOT call an empty voice list broken: they often have not loaded yet', () => {
    // Raising a false alarm on a working tablet is worse than waiting a
    // second. voiceName() === null is what the board keys its warning off.
    const fake = env({ voices: [] });
    fake.env.synthesis!.getVoices = () => [];
    const engine = createKitchenSpeech(fake.env);

    engine.speak('anything', () => {});
    expect(engine.unavailable()).toBe(false);
    expect(engine.voiceName('en')).toBeNull();
  });

  it('ignores empty text rather than speaking a pause', () => {
    const fake = env({ voices: both });
    const engine = createKitchenSpeech(fake.env);

    let ended = 0;
    engine.speak('   ', () => {
      ended += 1;
    });

    expect(ended).toBe(1);
    expect(fake.spoken).toHaveLength(0);
  });

  it('does not throw when the synthesiser itself throws', () => {
    const fake = env({ voices: both, throws: true });
    const engine = createKitchenSpeech(fake.env);

    let ended = 0;
    expect(() =>
      engine.speak('one', () => {
        ended += 1;
      }),
    ).not.toThrow();
    expect(ended).toBe(1);
  });

  it('picks up voices that load after the first render', () => {
    // getVoices() is empty for the first few hundred milliseconds on most
    // platforms, and the first announcement of the evening lands right there.
    const fake = env({ voices: [] });
    const engine = createKitchenSpeech(fake.env);
    expect(engine.voiceName('en')).toBeNull();

    // The platform finishes enumerating a moment later.
    fake.setVoices(both);
    engine.refreshVoices();

    engine.speak('One.', () => {});
    fake.flush();

    expect(fake.spoken[0].lang).toBe('en-IN');
  });

  it('has a watchdog long enough for a slow device but short enough to notice', () => {
    expect(DEFAULT_START_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(DEFAULT_START_TIMEOUT_MS).toBeLessThanOrEqual(8000);
  });
});
