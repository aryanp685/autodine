import { describe, expect, it } from 'vitest';
import {
  HINDI_LANGS,
  LEAD_IN_MS,
  VOICE_TUNING,
  createKitchenSpeech,
  pickHindiVoice,
  planSpeech,
  sentenceKind,
  splitSentences,
  voiceScore,
  type SpeechEnv,
  type SpeechOutcome,
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
    error?: string;
    neverEnd?: boolean;
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
          if (options.error) shaped.onerror?.({ error: options.error });
          else if (!options.neverEnd) shaped.onend?.();
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
      voiceScore({ name: 'Ravi', lang: 'hi-IN' }),
    );
  });

  it('down-ranks known female voice names', () => {
    const female = voiceScore({ name: 'Lekha', lang: 'hi-IN' });
    const male = voiceScore({ name: 'Ravi', lang: 'hi-IN' });
    const neutral = voiceScore({ name: 'Google हिन्दी', lang: 'hi-IN' });
    // A known female name scores below both a male name and a neutral name.
    expect(female).toBeLessThan(male);
    expect(female).toBeLessThan(neutral);
  });

  it('up-ranks known male voice names', () => {
    const male = voiceScore({ name: 'Madhur', lang: 'hi-IN' });
    const neutral = voiceScore({ name: 'Google हिन्दी', lang: 'hi-IN' });
    expect(male).toBeGreaterThan(neutral);
  });

  it('prefers a male voice over a female voice when both are installed', () => {
    const voices: VoiceLike[] = [
      { name: 'Lekha', lang: 'hi-IN', localService: true },
      { name: 'Ravi', lang: 'hi-IN', localService: false },
    ];
    expect(pickHindiVoice(voices)?.name).toBe('Ravi');
  });

  it('prefers a female voice when the target character is female', () => {
    const voices: VoiceLike[] = [
      { name: 'Lekha', lang: 'hi-IN', localService: true },
      { name: 'Ravi', lang: 'hi-IN', localService: false },
    ];
    expect(pickHindiVoice(voices, 'Female')?.name).toBe('Lekha');
    expect(voiceScore({ name: 'Lekha', lang: 'hi-IN' }, 'Female')).toBeGreaterThan(
      voiceScore({ name: 'Ravi', lang: 'hi-IN' }, 'Female'),
    );
  });

  it('treats gender as a preference, not a requirement', () => {
    // A lone Hindi voice is used whatever its gender — silence would be
    // worse than a mismatched voice on a kitchen device.
    const onlyFemale: VoiceLike[] = [{ name: 'Lekha', lang: 'hi-IN' }];
    expect(pickHindiVoice(onlyFemale, 'Male')?.name).toBe('Lekha');
    const onlyMale: VoiceLike[] = [{ name: 'Ravi', lang: 'hi-IN' }];
    expect(pickHindiVoice(onlyMale, 'Female')?.name).toBe('Ravi');
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

  it('chunks a long special instruction at clause/word boundaries without losing text', () => {
    const note = `ध्यान देना, ${'प्याज़ नहीं, लहसुन नहीं, तीखा थोड़ा कम रखना, अलग पैक करना, '.repeat(5)}आख़िरी निर्देश भी साथ रखना।`;
    const pieces = splitSentences(note);
    const restored = pieces.join(' ').replace(/\s+/g, ' ');

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0]).toMatch(/^ध्यान देना,/);
    expect(restored).toBe(note);
    const plan = planSpeech(note);
    expect(new Set(plan.map((segment) => segment.rate)).size).toBe(1);
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

    // Nothing yet: the board takes a breath after the chime first, the way a
    // person does, instead of starting on the same tick as the tone.
    expect(fake.timers[0]?.ms).toBe(LEAD_IN_MS);
    expect(fake.spoken).toHaveLength(0);

    fake.flush();

    // The danda is our separator, not a sound: it never reaches the engine.
    expect(fake.spoken.map((u) => u.text)).toEqual(['नया ऑर्डर, टेबल टी वन', 'दो बटर नान']);
    expect(ended).toBe(1);
  });

  it('chimes once before the first word, not once per sentence', () => {
    const fake = env({ voices: hindi });
    const engine = createKitchenSpeech(fake.env);

    engine.speak('नया ऑर्डर। एक। दो।', () => {});
    fake.flush();

    expect(fake.chimes).toBe(1);
    expect(fake.spoken).toHaveLength(3);
  });

  it('uses the Hindi voice and a human rate', () => {
    const fake = env({ voices: [...english, ...hindi] });
    createKitchenSpeech(fake.env).speak('नया ऑर्डर, टेबल टी वन।', () => {});
    fake.flush();

    expect(fake.spoken[0].voice?.lang).toBe('hi-IN');
    // The heading is read at the kitchen's brisk natural pace — a person
    // calling out an order, not a metronome reading aloud. Never below the
    // base pace (that is what made even "fast" sound slow), never chipmunk.
    expect(fake.spoken[0].rate).toBeGreaterThanOrEqual(VOICE_TUNING.rate);
    expect(fake.spoken[0].rate).toBeLessThan(1.5);
  });

  it('says nothing at all when the device has no Hindi voice', () => {
    const fake = env({ voices: english });
    const engine = createKitchenSpeech(fake.env);
    let result: SpeechOutcome | undefined;

    engine.speak('नया ऑर्डर, टेबल टी वन।', (outcome) => { result = outcome; });

    // Not one utterance, no chime: the board says why instead of playing a
    // voice that cannot read the sentence.
    expect(fake.spoken).toHaveLength(0);
    expect(fake.chimes).toBe(0);
    expect(result?.status).toBe('failed');
    if (result?.status === 'failed') expect(result.reason).toContain('Hindi voice');
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
    // Google हिन्दी is picked over Lekha: Lekha is a known female voice name
    // and is down-ranked. Google हिन्दी has no gender hint, so it is neutral
    // and wins on the google-vendor bonus alone.
    expect(engine.voiceName()).toBe('Google हिन्दी');
  });

  it('recovers from a wedged engine instead of dying quietly', () => {
    const fake = env({ voices: hindi, wedge: true });
    const engine = createKitchenSpeech(fake.env);
    let ended = 0;

    engine.speak('नया ऑर्डर, टेबल टी वन।', () => {
      ended += 1;
    });

    fake.flush(); // lead-in, then the watchdog

    expect(engine.stalled()).toBe(true);
    expect(fake.cancels).toBe(1); // the wedged utterance is cleared
    expect(ended).toBe(1); // and the queue is released

    // The next ticket is spoken normally.
    fake.setWedge(false);
    engine.speak('दो बटर नान।', () => {});
    fake.flush();
    expect(fake.spoken.at(-1)?.text).toBe('दो बटर नान');
  });

  it('survives a synthesiser that throws on speak', () => {
    const fake = env({ voices: hindi, throws: true });
    const engine = createKitchenSpeech(fake.env);
    let ended = 0;

    engine.speak('नया ऑर्डर।', () => {
      ended += 1;
    });
    fake.flush();

    expect(ended).toBe(1);
  });

  it('surfaces utterance onerror instead of treating it as successful playback', () => {
    const fake = env({ voices: hindi, error: 'synthesis-failed' });
    const engine = createKitchenSpeech(fake.env);
    let result: SpeechOutcome | undefined;

    engine.speak('नया ऑर्डर।', (outcome) => { result = outcome; });
    fake.flush();

    expect(result?.status).toBe('failed');
    if (result?.status === 'failed') expect(result.reason).toContain('synthesis-failed');
  });

  it('fails a started utterance that never fires onend and releases the engine', () => {
    const fake = env({ voices: hindi, neverEnd: true });
    const engine = createKitchenSpeech(fake.env, { completionTimeoutMs: 25 });
    let result: SpeechOutcome | undefined;

    engine.speak('नया ऑर्डर।', (outcome) => { result = outcome; });
    fake.flush();

    expect(result?.status).toBe('failed');
    if (result?.status === 'failed') expect(result.reason).toContain('finish before timeout');
    expect(fake.cancels).toBe(1);
  });

  it('reports cancellation during teardown instead of success', () => {
    const fake = env({ voices: hindi });
    const engine = createKitchenSpeech(fake.env);
    let result: SpeechOutcome | undefined;

    engine.speak('नया ऑर्डर।', (outcome) => { result = outcome; });
    engine.cancel();

    expect(result?.status).toBe('cancelled');
    expect(fake.cancels).toBe(1);
    expect(fake.timers).toHaveLength(0);
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

  it('paces each kind of sentence the way a person says it', () => {
    const plan = planSpeech('नया ऑर्डर, टेबल टी वन। एक बटर चिकन, आधा। ध्यान दें, प्याज़ नहीं।');

    const [greeting, dish, note] = plan;

    // A heading is read a little slower and followed by a real pause.
    expect(greeting.rate).toBeLessThan(dish.rate);
    expect(greeting.gapMs).toBeGreaterThan(dish.gapMs);

    // A constraint is the slowest thing on the ticket and comes after the
    // longest silence, so it is not mistaken for another dish.
    expect(note.rate).toBeLessThan(dish.rate);
    expect(note.leadMs).toBeGreaterThan(0);

    // The last sentence has nothing to wait for.
    expect(note.gapMs).toBe(0);
  });

  it('names the kind of each sentence, so the pacing is not a guess', () => {
    expect(sentenceKind('नया ऑर्डर, टेबल टी वन।')).toBe('greeting');
    expect(sentenceKind('एक बटर चिकन, आधा।')).toBe('dish');
    expect(sentenceKind('ध्यान दें, प्याज़ नहीं।')).toBe('note');
    expect(sentenceKind('ध्यान देना, प्याज़ नहीं।')).toBe('note');
    expect(sentenceKind('नोट, प्याज़ नहीं।')).toBe('note');
    // Nagpuri openers, note labels and closers from voice-personality.ts.
    expect(sentenceKind('अरे माय रे गुरु!')).toBe('greeting');
    expect(sentenceKind('सुन ना गुरु!')).toBe('greeting');
    expect(sentenceKind('ध्यान दे गुरु!')).toBe('greeting');
    expect(sentenceKind('अरे बाप रे गुरु!')).toBe('greeting');
    expect(sentenceKind('मान, झकास बनाओ और रौनक ला दो!')).toBe('greeting');
    expect(sentenceKind('और सुनों गुरु, एक ज़रूरी बात…')).toBe('note');
    expect(sentenceKind('और हाँ गुरु, ये बात ध्यान में रखना…')).toBe('note');
    expect(sentenceKind('और हाँ…')).toBe('note');
  });

  it('ends the note run at the closer, so a note never swallows the sign-off', () => {
    const plan = planSpeech(
      'अरे माय रे गुरु! टेबल नंबर पाँच से नया ऑर्डर आया है। और सुनों गुरु, एक ज़रूरी बात… प्याज़ नहीं। मान, झकास बनाओ और रौनक ला दो!',
    );
    const closer = plan[plan.length - 1];
    // The closer is a greeting, not more note: it gets the greeting pace.
    expect(sentenceKind(closer.text)).toBe('greeting');
  });

  it('takes a breath after the chime before speaking', () => {
    expect(LEAD_IN_MS).toBeGreaterThanOrEqual(200);
  });
});

describe('voices the operator can choose between', () => {
  it('lists only Hindi voices, because those are the only ones that can read the ticket', () => {
    const fake = env({ voices: [...english, ...hindi] });
    const engine = createKitchenSpeech(fake.env);

    expect(engine.hindiVoices().map((v) => v.name)).toEqual(['Google हिन्दी', 'Lekha']);
  });

  it('speaks in the voice that was chosen, not the automatic one', () => {
    const fake = env({ voices: [...english, ...hindi] });
    const engine = createKitchenSpeech(fake.env);

    expect(engine.setVoiceName('Google हिन्दी')).toBe(true);
    engine.speak('नया ऑर्डर।', () => {});
    fake.flush();

    expect(fake.spoken[0].voice?.name).toBe('Google हिन्दी');
  });

  it('refuses a stored choice this device does not have, rather than lying', () => {
    const fake = env({ voices: hindi });
    const engine = createKitchenSpeech(fake.env);

    expect(engine.setVoiceName('Microsoft Swara')).toBe(false);
    expect(engine.available()).toBe(true);
    expect(engine.setVoiceName(null)).toBe(true);
  });

  it('drops a stored voice preference when that voice disappears', () => {
    const fake = env({ voices: [...english, ...hindi] });
    const engine = createKitchenSpeech(fake.env);
    expect(engine.setVoiceName('Lekha')).toBe(true);
    fake.setVoices([{ name: 'Google हिन्दी', lang: 'hi-IN' }]);
    engine.refreshVoices();
    expect(engine.voiceName()).toBe('Google हिन्दी');
  });

  it('slows down when asked, and never past the point of being intelligible', () => {
    const fake = env({ voices: hindi });
    const engine = createKitchenSpeech(fake.env);

    engine.setRateScale(0.85);
    engine.speak('नया ऑर्डर।', () => {});
    fake.flush();
    const slow = fake.spoken[0].rate;

    engine.setRateScale(1);
    engine.speak('नया ऑर्डर।', () => {});
    fake.flush();
    const normal = fake.spoken[1].rate;

    engine.setRateScale(99);
    engine.speak('नया ऑर्डर।', () => {});
    fake.flush();

    expect(slow).toBeLessThan(normal);
    expect(fake.spoken[2].rate).toBeLessThanOrEqual(1.5);
  });

  it('never hands the danda to the engine, which would clip it as a stutter', () => {
    const fake = env({ voices: hindi });
    createKitchenSpeech(fake.env).speak('नया ऑर्डर, टेबल टी वन। दो बटर नान।', () => {});
    fake.flush();

    for (const utterance of fake.spoken) expect(utterance.text).not.toContain('।');
  });
});
