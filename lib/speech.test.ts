import { describe, expect, it } from 'vitest';
import { createKitchenSpeech, pickVoice, VOICE_LANGS, type SpeechEnv, type VoiceLike } from './speech';

/**
 * The kitchen voice.
 *
 * These tests are about the failure modes that all look the same from the
 * outside -- silence. On a wall tablet the difference between "the kitchen was
 * told" and "the kitchen was not told" is invisible unless the engine reports
 * it, so what is tested here is the reporting as much as the speaking.
 */

type FakeUtterance = {
  text: string;
  voice: VoiceLike | null;
  lang: string;
  rate: number;
  pitch: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function env(options: {
  voices?: VoiceLike[];
  /** Start each utterance immediately, as a working device does. */
  autoStart?: boolean;
  /** Never fire onstart or onend, as Chrome does when it wedges. */
  wedge?: boolean;
  throws?: boolean;
} = {}) {
  const spoken: FakeUtterance[] = [];
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let nextId = 1;
  let chimes = 0;
  let cancels = 0;

  // Mutable so a test can make the first utterance wedge and the second work,
  // which is what recovering from a stuck synthesiser looks like.
  let wedge = options.wedge ?? false;

  const speechEnv: SpeechEnv = {
    synthesis: {
      speak(utterance) {
        if (options.throws) throw new Error('no audio device');
        spoken.push(utterance as FakeUtterance);
        if (wedge) return;
        if (options.autoStart) {
          const u = utterance as FakeUtterance;
          u.onstart?.();
          u.onend?.();
        }
      },
      cancel() {
        cancels += 1;
      },
      getVoices: () => options.voices ?? [],
      speaking: false,
    },
    createUtterance: (text) => ({
      text,
      voice: null,
      lang: '',
      rate: 1,
      pitch: 1,
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
    /** Fire every watchdog still armed, as a wedged browser would. */
    fireTimers() {
      const pending = [...timers];
      timers.length = 0;
      for (const timer of pending) timer.fn();
    },
    setWedge(next: boolean) {
      wedge = next;
    },
  };
}

const voices: VoiceLike[] = [
  { name: 'English (United States)', lang: 'en-US', localService: true },
  { name: 'Google UK English Female', lang: 'en-GB', localService: false },
  { name: 'Google हिन्दी', lang: 'hi-IN', localService: false },
  { name: 'English (India)', lang: 'en-IN', localService: true },
];

describe('pickVoice', () => {
  it('prefers Indian English, which pronounces a menu the way the menu is written', () => {
    expect(pickVoice(voices)?.name).toBe('English (India)');
  });

  it('falls back through the list when en-IN is not installed', () => {
    const withoutIndia = voices.filter((v) => v.lang !== 'en-IN');
    expect(pickVoice(withoutIndia)?.name).toBe('Google UK English Female');
  });

  it('takes any English voice rather than reading in another language', () => {
    const onlyHindi = [{ name: 'Google हिन्दी', lang: 'hi-IN' }];
    expect(pickVoice(onlyHindi)).toBeNull();
  });

  it('prefers a local voice within the same language: no network round trip', () => {
    const same: VoiceLike[] = [
      { name: 'B', lang: 'en-IN', localService: false },
      { name: 'A', lang: 'en-IN', localService: true },
    ];
    expect(pickVoice(same)?.name).toBe('A');
  });

  it('returns null rather than guessing when nothing is installed', () => {
    expect(pickVoice([])).toBeNull();
  });

  it('starts at Indian English, before anything else', () => {
    expect(VOICE_LANGS[0]).toBe('en-IN');
  });
});

describe('createKitchenSpeech', () => {
  it('speaks, and reports the voice it chose', () => {
    const fake = env({ voices, autoStart: true });
    const speech = createKitchenSpeech(fake.env);

    let ended = 0;
    speech.speak('New order, table T1.', () => {
      ended += 1;
    });

    expect(fake.spoken[0].text).toBe('New order, table T1.');
    expect(fake.spoken[0].lang).toBe('en-IN');
    expect(ended).toBe(1);
    expect(speech.voiceName()).toBe('English (India)');
  });

  it('chimes before every announcement, even when the voice is dead', () => {
    // In a loud kitchen a sentence that starts at conversational volume is
    // half-missed, and the chime still works on a device with broken TTS.
    const fake = env({ voices, autoStart: true });
    const speech = createKitchenSpeech(fake.env);

    speech.speak('one', () => {});
    speech.speak('two', () => {});

    expect(fake.chimes).toBe(2);
  });

  it('still ends the queue when the platform has no synthesiser at all', () => {
    const fake = env({ voices });
    fake.env.synthesis = null;
    const speech = createKitchenSpeech(fake.env);

    let ended = 0;
    speech.speak('anything', () => {
      ended += 1;
    });

    expect(ended).toBe(1);
    expect(speech.unavailable()).toBe(true);
  });

  it('reports a voice list with no English voice as unusable', () => {
    const fake = env({ voices: [{ name: 'Google हिन्दी', lang: 'hi-IN' }], autoStart: true });
    const speech = createKitchenSpeech(fake.env);

    speech.speak('anything', () => {});
    expect(speech.unavailable()).toBe(true);
    expect(speech.voiceName()).toBeNull();
  });

  it('does NOT call an empty voice list broken: they often have not loaded yet', () => {
    // Raising a false alarm on a working tablet is worse than waiting a
    // second. voiceName() === null is what the board keys its warning off.
    const fake = env({ voices: [], autoStart: true });
    const speech = createKitchenSpeech(fake.env);

    speech.speak('anything', () => {});
    expect(speech.unavailable()).toBe(false);
    expect(speech.voiceName()).toBeNull();
  });

  it('calls back exactly once when an utterance fires both end and error', () => {
    // Some engines fire onend AND onerror for one utterance. Two callbacks
    // would start the next announcement twice -- the overlap this whole
    // module exists to prevent.
    const fake = env({ voices });
    const speech = createKitchenSpeech(fake.env);

    let ended = 0;
    speech.speak('one', () => {
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
    const fake = env({ voices, wedge: true });
    const speech = createKitchenSpeech(fake.env);

    let ended = 0;
    speech.speak('one', () => {
      ended += 1;
    });

    expect(ended).toBe(0);
    expect(fake.timers).toHaveLength(1);

    fake.fireTimers();

    expect(ended).toBe(1);
    expect(speech.stalled()).toBe(true);
    // Freeing the wedged utterance is the only way the next one can play.
    expect(fake.cancels).toBe(1);
  });

  it('clears the stall flag once a later announcement actually starts', () => {
    const fake = env({ voices, wedge: true });
    const speech = createKitchenSpeech(fake.env);

    speech.speak('one', () => {});
    fake.fireTimers();
    expect(speech.stalled()).toBe(true);

    // The synthesiser recovers and the next announcement actually starts.
    fake.setWedge(false);
    speech.speak('two', () => {});
    fake.spoken.at(-1)?.onstart?.();

    expect(speech.stalled()).toBe(false);
  });

  it('ignores empty text rather than speaking a pause', () => {
    const fake = env({ voices, autoStart: true });
    const speech = createKitchenSpeech(fake.env);

    let ended = 0;
    speech.speak('   ', () => {
      ended += 1;
    });

    expect(ended).toBe(1);
    expect(fake.spoken).toHaveLength(0);
  });

  it('does not throw when the synthesiser itself throws', () => {
    const fake = env({ voices, throws: true });
    const speech = createKitchenSpeech(fake.env);

    let ended = 0;
    expect(() =>
      speech.speak('one', () => {
        ended += 1;
      }),
    ).not.toThrow();
    expect(ended).toBe(1);
  });

  it('picks up voices that load after the first render', () => {
    // getVoices() is empty for the first few hundred milliseconds on most
    // platforms, and the first announcement of the evening lands right there.
    const fake = env({ voices: [], autoStart: true });
    const speech = createKitchenSpeech(fake.env);
    expect(speech.voiceName()).toBeNull();

    (fake.env.synthesis as { getVoices: () => VoiceLike[] }).getVoices = () => voices;
    speech.refreshVoices();

    speech.speak('one', () => {});
    expect(fake.spoken[0].lang).toBe('en-IN');
  });
});
