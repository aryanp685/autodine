import { describe, expect, it } from 'vitest';
import {
  MAX_BACKLOG,
  advanceText,
  cancelText,
  announceLogLabel,
  createAnnounceQueue,
  isTakeaway,
  newOrderText,
  orderAnnouncement,
  primeOnOpen,
  selectNewTickets,
  spokenAddons,
  spokenDetail,
  spokenItem,
  spokenPortion,
  spokenTable,
  type SpeakableItem,
} from './announce';
import { isDevanagariOnly } from './hindi';
import type { SpeechOutcome } from './speech';

/**
 * What the kitchen hears.
 *
 * Two properties matter more than any individual string, and both are tested
 * as properties rather than as examples:
 *
 *   1. the sentence is Devanagari end to end -- no Latin is handed to a Hindi
 *      voice, because some of them skip it silently
 *   2. the order of information is table, then dishes, then the note
 */

const naan: SpeakableItem = { qty: 2, name: 'Butter Naan', detail: 'Full' };
const chicken: SpeakableItem = { qty: 1, name: 'Butter Chicken', detail: 'Half · Butter naan' };

describe('spokenTable', () => {
  it('says the number of a printed card label — "T2" is table two, not "t2"', () => {
    // The card prints "T2"; the T is the word "Table" and the sentence around
    // this already says "टेबल नंबर". Spelling it gave "टेबल नंबर टी दो", which a
    // kitchen hears as "t2". The number is the fact, said as a Hindi word.
    expect(spokenTable('T1')).toBe('एक');
    expect(spokenTable('T2')).toBe('दो');
    expect(spokenTable('T12')).toBe('बारह');
    expect(spokenTable('t-2')).toBe('दो');
    expect(spokenTable('Table 3')).toBe('तीन');
  });

  it('keeps a letter that is NOT the word "table" — a section mark is information', () => {
    expect(spokenTable('A2')).toBe('ए दो');
    expect(spokenTable('2')).toBe('दो');
  });

  it('reads a table number past twenty as one number', () => {
    // A hall with thirty tables is ordinary. "T21" said digit by digit is
    // "टू वन" -- a table two-one, which is not a table, and the pass walks
    // to the wrong one.
    expect(spokenTable('T21')).toBe('इक्कीस');
    expect(spokenTable('T30')).toBe('तीस');
    expect(spokenTable('T99')).toBe('निन्यानवे');
  });

  it('says a room as a word and the number digit by digit', () => {
    // "Room 204" is a room, not four letters followed by three digits, and
    // a room number is spoken one digit at a time everywhere.
    expect(spokenTable('Room 204')).toBe('रूम दो शून्य चार');
  });

  it('has words for a takeaway ticket, which has no table', () => {
    expect(spokenTable('Takeaway')).toBe('टेकअवे');
    expect(spokenTable('Counter')).toBe('टेकअवे');
    expect(spokenTable('')).toBe('टेकअवे');
  });

  it('knows which labels mean "no table"', () => {
    expect(isTakeaway('T1')).toBe(false);
    expect(isTakeaway('take away')).toBe(true);
  });
});

describe('spokenItem', () => {
  it('keeps quantity and portion attached to the dish in conversational kitchen Hindi', () => {
    // Mumbai kitchens commonly say "हाफ" and "फुल" for these menu variants.
    expect(spokenItem({ qty: 2, name: 'Butter Naan', detail: 'Half' })).toBe('दो हाफ बटर नान');
  });

  it('says a Bombay quarter the way a kitchen says it', () => {
    expect(spokenItem({ qty: 1, name: 'Veg Biryani', detail: 'Quarter' })).toBe('एक पाव वेज बिरयानी');
  });

  it('puts an add-on after the dish, because it is an instruction about it', () => {
    expect(spokenItem({ qty: 1, name: 'Butter Naan', detail: 'Extra cheese' })).toBe(
      'एक बटर नान, एक्स्ट्रा चीज़',
    );
  });

  it('keeps portion and add-on on their own sides of the dish name', () => {
    expect(spokenItem({ qty: 2, name: 'Butter Naan', detail: 'Half · Extra cheese' })).toBe(
      'दो हाफ बटर नान, एक्स्ट्रा चीज़',
    );
  });

  it('keeps add-ons, translated and in order', () => {
    expect(spokenDetail('Half · Extra cheese')).toBe('हाफ, एक्स्ट्रा चीज़');
  });

  it('translates an add-on nobody has heard of instead of dropping it', () => {
    expect(isDevanagariOnly(spokenDetail('Peri Peri'))).toBe(true);
  });

  it('separates the portion from the add-ons, because they sit on opposite sides', () => {
    expect(spokenPortion('Half · Extra cheese')).toBe('हाफ');
    expect(spokenAddons('Half · Extra cheese')).toBe('एक्स्ट्रा चीज़');
    // An unknown word is not a portion, so it trails the dish rather than
    // being pushed in front of its name.
    expect(spokenPortion('Peri Peri')).toBe('');
    expect(spokenAddons('Peri Peri')).not.toBe('');
  });

  it('treats "Half Plate" as a portion, not as a second dish', () => {
    // Most menus write the portion as a measure. Filed as an add-on it trails
    // the dish name, and a cook hears two items instead of one.
    expect(spokenItem({ qty: 1, name: 'Paneer Butter Masala', detail: 'Half Plate' })).toBe(
      'एक आधी प्लेट पनीर बटर मसाला',
    );
    // Feminine, because प्लेट is. "आधा प्लेट" is an accent.
    expect(spokenItem({ qty: 2, name: 'Butter Naan', detail: 'Full Plate · Extra cheese' })).toBe(
      'दो पूरी प्लेट बटर नान, एक्स्ट्रा चीज़',
    );
  });

  it('says a weight the way it is written on the board, not letter by letter', () => {
    // "Half kg" used to come out as "आधा क्ग": the abbreviation was
    // transliterated as if it were a word.
    expect(spokenItem({ qty: 1, name: 'Masala Dosa', detail: 'Half kg · Extra spicy' })).toBe(
      'एक आधा किलो मसाला डोसा, ज़्यादा तीखा',
    );
  });

  it('keeps a measure portion on the portion side', () => {
    expect(spokenPortion('Half Plate · Extra cheese')).toBe('आधी प्लेट');
    expect(spokenAddons('Half Plate · Extra cheese')).toBe('एक्स्ट्रा चीज़');
  });

  it('says the owner\'s pronunciation instead of the generated one', () => {
    // The board must never rename a dish behind the restaurant's back: when a
    // pronunciation has been set, it is what the kitchen hears.
    expect(spokenItem({ qty: 1, name: 'Bhaji', spoken: 'भज्जी' })).toBe('एक भज्जी');
  });

  it('says a pizza name that is printed in English on the menu', () => {
    // Rule transliteration mangles this one into "मैर्घेरिटा"; the menu words
    // win when they are known.
    expect(spokenItem({ qty: 1, name: 'Margherita Pizza', detail: 'Large' })).toBe(
      'एक बड़ा मार्गेरिटा पिज़्ज़ा',
    );
  });

  it('still says the dish when there is no portion', () => {
    expect(spokenItem({ qty: 3, name: 'Masala Dosa' })).toBe('तीन मसाला डोसा');
  });
});

describe('newOrderText', () => {
  it('says table first, dishes next, the guest note last', () => {
    const text = newOrderText('T1', [chicken], 'no onion');

    expect(text).toBe('नया ऑर्डर आया है। टेबल एक। एक हाफ बटर चिकन, बटर नान। प्याज़ नहीं।');
  });

  it('never hands a Latin letter to the voice', () => {
    const menus: SpeakableItem[][] = [
      [chicken, naan],
      [{ qty: 1, name: 'Quesadilla', detail: 'Large · Extra cheese' }],
      [{ qty: 2, name: 'Cold Coffee', detail: 'Regular' }],
      [{ qty: 1, name: 'मिसळ पाव' }],
    ];

    for (const items of menus) {
      expect(isDevanagariOnly(newOrderText('T12', items, 'less spicy, no onion'))).toBe(true);
    }
  });

  it('reads a portion and the add-ons in the order a person says them', () => {
    // The exact shape place_public_order snapshots: variant name, then each
    // add-on, joined the way order_items stores them.
    const text = newOrderText('T1', [
      { qty: 1, name: 'Butter Naan', detail: 'Half · Extra cheese · Jain' },
    ]);

    expect(text).toBe('नया ऑर्डर आया है। टेबल एक। एक हाफ बटर नान, एक्स्ट्रा चीज़, जैन।');
  });

  it('says the restaurant\'s own add-ons, not just the ones we know', () => {
    // An owner will invent names this file has never seen. They are read out
    // rather than dropped, because the guest paid for them.
    const text = newOrderText('T2', [
      { qty: 2, name: 'Masala Dosa', detail: 'Extra mint chutney · Onion salad' },
    ]);

    expect(text).toContain('एक्स्ट्रा मिंट चटनी');
    expect(text).toContain('प्याज़ सलाद');
  });

  it('says the note directly, as the guest\'s instruction — no label word', () => {
    // "ध्यान देना" / "नोट" were words that were neither the order nor the
    // note. The note is already phrased as something a cook acts on, so it
    // is said as written: "प्याज़ नहीं", "तीखा बनाना".
    const text = newOrderText('T3', [naan], 'no onion');
    expect(text).toContain('प्याज़ नहीं');
    expect(text).not.toContain('ध्यान देना');
    expect(text).not.toContain('नोट');
    expect(text.indexOf('प्याज़')).toBeGreaterThan(text.indexOf('नान'));
    expect(text.trimEnd().endsWith('प्याज़ नहीं।')).toBe(true);
  });

  it('omits the note entirely when there is none', () => {
    expect(newOrderText('T3', [naan])).not.toContain('प्याज़');
    expect(newOrderText('T3', [naan], '   ')).not.toContain('प्याज़');
    expect(newOrderText('T3', [naan], '   ').trimEnd().endsWith('नान।')).toBe(true);
  });

  it('reads a room label and number in the order printed', () => {
    expect(newOrderText('Room 204', [naan])).toContain('टेबल रूम दो शून्य चार।');
  });

  it('speaks a takeaway ticket without inventing a table', () => {
    const text = newOrderText('Takeaway', [naan]);
    expect(text.startsWith('नया टेकअवे ऑर्डर आया है।')).toBe(true);
    expect(text).not.toContain('टेबल');
  });

  it('announces every item instead of silently summarizing operational details', () => {
    const items: SpeakableItem[] = Array.from({ length: 7 }, (_, i) => ({
      qty: 1,
      name: `Dish ${i + 1}`,
    }));

    const text = newOrderText('T5', items);
    for (let i = 1; i <= 7; i += 1) expect(text).toContain(`डिश ${['एक','दो','तीन','चार','पाँच','छह','सात'][i - 1]}`);
    expect(text).not.toContain('और तीन आइटम');
  });

  it('uses a conversational Mumbai-style order with grouped dishes and a real table label', () => {
    expect(newOrderText('T5', [
      { qty: 2, name: 'Paneer Tikka' },
      { qty: 1, name: 'Butter Naan' },
    ], 'less spicy')).toBe(
      'नया ऑर्डर आया है। टेबल पाँच। दो पनीर टिक्का और एक बटर नान। तीखा थोड़ा कम रखना।',
    );
  });

  it('says "टेबल दो" for the card label T2 — the number, not the letters', () => {
    expect(newOrderText('T2', [naan])).toContain('टेबल दो।');
    expect(newOrderText('T2', [naan])).not.toContain('टी');
  });

  it('says a note the way Hindi says it, not word for word', () => {
    // "no onion" word for word is "नो प्याज़" -- understood, and not spoken by
    // anyone. Hindi negates at the end and quantifies at the front. A
    // quantity note is an instruction: "extra butter" is "बटर ज़्यादा डालना".
    expect(newOrderText('T2', [naan], 'no onion')).toContain('प्याज़ नहीं');
    expect(newOrderText('T2', [naan], 'without garlic')).toContain('लहसुन के बिना');
    expect(newOrderText('T2', [naan], 'less spicy')).toContain('तीखा थोड़ा कम रखना');
    expect(newOrderText('T2', [naan], 'extra cheese')).toContain('चीज़ ज़्यादा डालना');
    expect(newOrderText('T2', [naan], 'extra butter')).toContain('बटर ज़्यादा डालना');
  });

  it('preserves a long guest note rather than silently truncating it', () => {
    const note = 'कृपया ध्यान दें '.repeat(30);
    const text = newOrderText('T5', [naan], note);
    expect(text.split('कृपया').length - 1).toBe(30);
    expect(text).not.toContain('…');
  });
});

describe('advanceText', () => {
  it('says which table moved on', () => {
    expect(advanceText('T2', 'preparing')).toBe('टेबल दो, बनना शुरू।');
    expect(advanceText('T2', 'ready')).toBe('टेबल दो तैयार है।');
    expect(advanceText('T2', 'served')).toBe('टेबल दो सर्व हो गया।');
  });

  it('does not read out "table takeaway"', () => {
    expect(advanceText('Takeaway', 'preparing')).toBe('टेकअवे ऑर्डर बन रहा है।');
    expect(advanceText('Takeaway', 'ready')).toBe('टेकअवे ऑर्डर तैयार है।');
  });

  it('degrades to a real sentence for a state it does not know', () => {
    expect(advanceText('T4', 'cancelled')).toBe('टेबल चार, कैंसल।');
  });
});

describe('cancelText', () => {
  it('names the table whose order was stopped', () => {
    expect(cancelText('T2')).toBe('टेबल दो का ऑर्डर कैंसल हो गया।');
  });

  it('does not read out "table takeaway"', () => {
    expect(cancelText('Takeaway')).toBe('टेकअवे ऑर्डर कैंसल हो गया।');
  });

  it('is speakable by a Hindi voice and nothing else', () => {
    for (const table of ['T1', 'T12', 'Takeaway']) {
      expect(isDevanagariOnly(cancelText(table))).toBe(true);
    }
  });
});

describe('announceLogLabel', () => {
  it('is dense, because it is read on screen not aloud', () => {
    expect(announceLogLabel('T1', [naan, chicken])).toBe('T1 · 3 आइटम');
    expect(announceLogLabel('Takeaway', [naan])).toBe('Takeaway · 2 आइटम');
  });
});

describe('orderAnnouncement', () => {
  it('is the same builder a real ticket uses', () => {
    expect(
      orderAnnouncement({ table: 'T7', items: [naan], note: 'jain', placedAtIso: '2026-01-01T00:00:00Z' }),
    ).toBe(newOrderText('T7', [naan], 'jain'));
  });
});

/* ------------------------------------------------------------------ queue */

function recorder() {
  const heard: string[] = [];
  const queue = createAnnounceQueue({
    speak(text, onEnd) {
      heard.push(text);
      onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    },
  });
  return { queue, heard };
}

describe('announcement queue', () => {
  it('announces a burst in arrival order, complete, never cut', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 });
      },
    });

    // Four orders in the same second -- the case this whole module exists for.
    for (let i = 1; i <= 4; i += 1) {
      queue.push(`o${i}`, `नया ऑर्डर ${i}।`);
    }

    expect(heard).toEqual(['नया ऑर्डर 1।', 'नया ऑर्डर 2।', 'नया ऑर्डर 3।', 'नया ऑर्डर 4।']);
  });

  it('does not repeat a ticket it has already said', () => {
    const { queue, heard } = recorder();

    expect(queue.push('o1', 'एक।')).toBe('queued');
    expect(queue.push('o1', 'एक।')).toBe('duplicate');
    expect(heard).toEqual(['एक।']);
  });

  it('allows different order IDs with identical wording but rejects duplicate IDs', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        setTimeout(() => onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 }), 0);
      },
    });

    queue.push('now', 'अभी।'); // speaking
    expect(queue.push('a', 'नया ऑर्डर, टेबल टी एक।')).toBe('queued');
    expect(queue.push('b', 'नया ऑर्डर, टेबल टी एक।')).toBe('queued');
    expect(queue.push('a', 'नया ऑर्डर, टेबल टी एक।')).toBe('duplicate');
    expect(queue.pending()).toBe(2);
  });

  it('replays on request, even while the original is still waiting', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        setTimeout(() => onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 }), 0);
      },
    });

    queue.push('o1', 'एक।'); // speaking now
    queue.push('o2', 'दो।'); // waiting

    // Replay of the waiting one must replace it, not be refused.
    expect(queue.force('o2:replay', 'दो।')).toBe('queued');
    expect(queue.pending()).toBe(2);
  });

  it('keeps the backlog bounded for state changes but never for orders', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        setTimeout(() => onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 }), 0);
      },
    });

    queue.push('now', 'अभी।'); // occupies the speaker

    for (let i = 0; i < MAX_BACKLOG + 3; i += 1) {
      queue.push(`info${i}`, `जानकारी ${i}।`, 'info');
    }

    // Every order still gets in, because an unannounced ticket is a cold plate.
    expect(queue.push('order', 'ऑर्डर।')).toBe('queued');
    expect(queue.pending()).toBeLessThanOrEqual(MAX_BACKLOG + 1);
  });

  it('survives a speaker that calls back twice', () => {
    const started: string[] = [];
    const callbacks: ((outcome: SpeechOutcome) => void)[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        started.push(text);
        callbacks.push(onEnd);
      },
    });

    queue.push('a', 'एक।');
    queue.push('b', 'दो।');
    callbacks[0]!({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    callbacks[0]!({ status: 'failed', reason: 'duplicate callback', completedSegments: 0, totalSegments: 1 });

    expect(started).toEqual(['एक।', 'दो।']);
    expect(queue.pending()).toBe(0);
  });

  it('does not wedge when the speaker throws', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        if (text === 'बुरा।') throw new Error('engine died');
        onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 });
      },
    });

    queue.push('a', 'बुरा।');
    queue.push('b', 'ठीक।');

    expect(heard).toEqual(['बुरा।', 'ठीक।']);
  });

  it('does not mark failed speech as complete and accepts an explicit retry', () => {
    const outcomes: string[] = [];
    let attempt = 0;
    const queue = createAnnounceQueue(
      { speak(_text, onEnd) {
        attempt += 1;
        onEnd(attempt === 1
          ? { status: 'failed', reason: 'onerror', completedSegments: 0, totalSegments: 1 }
          : { status: 'completed', completedSegments: 1, totalSegments: 1 });
      } },
      { onResult: (_entry, outcome) => outcomes.push(outcome.status) },
    );

    expect(queue.push('order-1', 'एक।')).toBe('queued');
    expect(queue.has('order-1')).toBe(false);
    expect(queue.contains('order-1')).toBe(true);
    expect(queue.push('order-1', 'एक।')).toBe('duplicate');
    expect(queue.force('order-1:retry-1', 'एक।')).toBe('queued');
    expect(queue.has('order-1:retry-1')).toBe(true);
    expect(outcomes).toEqual(['failed', 'completed']);
  });

  it('reports a full queue instead of silently dropping an order', () => {
    const queue = createAnnounceQueue({ speak() { /* hold active item */ } });
    expect(queue.push('active', 'एक।')).toBe('queued');
    for (let i = 0; i < 19; i += 1) expect(queue.push(`order-${i}`, 'दो।')).toBe('queued');
    expect(queue.push('overflow', 'तीन।')).toBe('full');
    expect(queue.depth()).toBe(20);
  });

  it('ignores late speaker callbacks after queue teardown', () => {
    let release: (outcome: SpeechOutcome) => void = () => {};
    const outcomes: string[] = [];
    const queue = createAnnounceQueue(
      { speak(_text, onEnd) { release = onEnd; } },
      { onResult: (_entry, outcome) => outcomes.push(outcome.status) },
    );
    queue.push('in-flight', 'एक।');
    queue.dispose();
    release({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    expect(outcomes).toEqual([]);
    expect(queue.depth()).toBe(0);
  });

  it('refuses empty text rather than speaking silence', () => {
    const { queue, heard } = recorder();
    expect(queue.push('a', '   ')).toBe('empty');
    expect(heard).toEqual([]);
  });
});

describe('what the board is told about the queue', () => {
  /**
   * The board used to set these itself from the push call, which is a guess:
   * "the thing I just pushed is what is playing" is wrong the moment two
   * orders arrive together, and the counter it drew never came back down.
   */
  it('names what is speaking, not what was queued last', () => {
    const begins: string[] = [];
    let release: (outcome: SpeechOutcome) => void = () => {};

    const queue = createAnnounceQueue(
      {
        speak(_text, onEnd) {
          release = onEnd; // hold the speaker open
        },
      },
      { onBegin: (entry) => begins.push(entry.text) },
    );

    queue.push('o1', 'पहला।');
    queue.push('o2', 'दूसरा।');
    queue.push('o3', 'तीसरा।');

    // Only the first has reached the speaker. The other two are still waiting,
    // so the board must not claim they were announced.
    expect(begins).toEqual(['पहला।']);
    expect(queue.pending()).toBe(2);

    release({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    expect(begins).toEqual(['पहला।', 'दूसरा।']);
    expect(queue.pending()).toBe(1);

    release({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    release({ status: 'completed', completedSegments: 1, totalSegments: 1 }); // the last one, then idle
    expect(begins).toEqual(['पहला।', 'दूसरा।', 'तीसरा।']);
    expect(queue.pending()).toBe(0);
  });

  it('says when it has gone quiet, so a waiting counter can return to zero', () => {
    const events: string[] = [];

    createAnnounceQueue(
      { speak(_text, onEnd) { onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 }); } },
      {
        onBegin: (entry) => events.push(`begin:${entry.key}`),
        onIdle: () => events.push('idle'),
      },
    ).push('o1', 'एक।');

    expect(events).toEqual(['begin:o1', 'idle']);
  });

  it('goes idle only after the last announcement, never in the middle of a burst', () => {
    const events: string[] = [];
    const releases: ((outcome: SpeechOutcome) => void)[] = [];

    const queue = createAnnounceQueue(
      { speak(_text, onEnd) { releases.push(onEnd); } },
      { onBegin: (entry) => events.push(`begin:${entry.key}`), onIdle: () => events.push('idle') },
    );

    queue.push('o1', 'एक।');
    queue.push('o2', 'दो।');
    releases[0]({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    expect(events).toEqual(['begin:o1', 'begin:o2']);
    releases[1]({ status: 'completed', completedSegments: 1, totalSegments: 1 });
    expect(events).toEqual(['begin:o1', 'begin:o2', 'idle']);
  });

  it('is not stopped by a listener that throws', () => {
    const queue = createAnnounceQueue(
      { speak(_text, onEnd) { onEnd({ status: 'completed', completedSegments: 1, totalSegments: 1 }); } },
      {
        onBegin() {
          throw new Error('board bug');
        },
        onIdle() {
          throw new Error('board bug');
        },
      },
    );

    expect(queue.push('o1', 'एक।')).toBe('queued');
    expect(queue.speaking()).toBe(false);
  });
});

/* ------------------------------------------------------- opening the board */

const iso = (minutesAgo: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - minutesAgo * 60_000).toISOString();
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

describe('primeOnOpen', () => {
  it('does not read out the whole afternoon when the board opens mid-service', () => {
    const tickets = [
      { orderId: 'old', table: 'T1', placedAtIso: iso(240), items: [] },
      { orderId: 'recent', table: 'T2', placedAtIso: iso(5), items: [] },
    ];

    const { seen, missed } = primeOnOpen(tickets, [], NOW);

    expect(seen).toEqual(['old', 'recent']);
    expect(missed.map((t) => t.orderId)).toEqual(['recent']);
  });

  it('never offers again what a previous session already said', () => {
    const tickets = [{ orderId: 'seen-before', table: 'T1', placedAtIso: iso(2), items: [] }];
    const { missed } = primeOnOpen(tickets, ['seen-before'], NOW);
    expect(missed).toEqual([]);
  });

  it('ignores demo rows, which have no identity to remember', () => {
    const { seen } = primeOnOpen([{ table: 'T1', placedAtIso: iso(1), items: [] }], [], NOW);
    expect(seen).toEqual([]);
  });
});

describe('selectNewTickets', () => {
  it('returns each ticket exactly once, by id', () => {
    const tickets = [
      { orderId: 'a', table: 'T1', items: [] },
      { orderId: 'b', table: 'T2', items: [] },
    ];

    expect(selectNewTickets(tickets, ['a']).map((t) => t.orderId)).toEqual(['b']);
    expect(selectNewTickets(tickets, ['a', 'b'])).toEqual([]);
  });

  it('ignores a row with no id, which cannot be announced exactly once', () => {
    expect(selectNewTickets([{ table: 'T1', items: [] }], [])).toEqual([]);
  });
});
