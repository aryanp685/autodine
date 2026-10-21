import { describe, expect, it } from 'vitest';
import {
  advanceText,
  chooseLanguage,
  createAnnounceQueue,
  MAX_BACKLOG,
  MAX_SPOKEN_ITEMS,
  newOrderText,
  numberWord,
  orderAnnouncement,
  primeOnOpen,
  selectNewTickets,
  spokenTable,
  summariseItems,
  type Speaker,
} from './announce';

/**
 * The queue exists because a kitchen takes several orders at once.
 *
 * These tests are mostly about that case: four tables ordering in the same
 * second must produce four complete announcements, in order, with nothing
 * cancelled mid-word. The previous implementation called
 * speechSynthesis.cancel() before each utterance, which meant three of those
 * four were cut off and the kitchen heard a sentence fragment.
 */

/**
 * A speaker that holds each utterance open until told to finish, so the test
 * can decide when one announcement ends and prove the next has not started.
 */
function controllable() {
  const spoken: string[] = [];
  let finishCurrent: (() => void) | null = null;
  let started = 0;

  const speaker: Speaker = {
    speak(text, onEnd) {
      started += 1;
      spoken.push(text);
      finishCurrent = onEnd;
    },
  };

  return {
    speaker,
    spoken,
    get started() {
      return started;
    },
    finish() {
      const done = finishCurrent;
      finishCurrent = null;
      done?.();
    },
  };
}

/** A speaker that finishes immediately, for the simple cases. */
function immediate() {
  const spoken: string[] = [];
  const speaker: Speaker = {
    speak(text, onEnd) {
      spoken.push(text);
      onEnd();
    },
  };
  return { speaker, spoken };
}

describe('createAnnounceQueue', () => {
  it('speaks one announcement at a time', () => {
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    queue.push('a', 'first');
    queue.push('b', 'second');

    // Only the first has been handed to the speaker.
    expect(ctl.spoken).toEqual(['first']);
    expect(queue.pending()).toBe(1);
    expect(queue.speaking()).toBe(true);

    ctl.finish();

    // Finishing the first starts the second, which is the queue working --
    // it does not go idle while anything is still waiting.
    expect(ctl.spoken).toEqual(['first', 'second']);
    expect(queue.pending()).toBe(0);
    expect(queue.speaking()).toBe(true);

    ctl.finish();
    expect(queue.speaking()).toBe(false);
  });

  it('gets through all four when four tables order at once', () => {
    // The case that was broken: a burst where nothing may be dropped or cut
    // off, and every sentence must be spoken whole.
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    queue.push('o1', 'New order for T1.');
    queue.push('o2', 'New order for T2.');
    queue.push('o3', 'New order for T3.');
    queue.push('o4', 'New order for T4.');

    expect(queue.pending()).toBe(3);

    ctl.finish();
    ctl.finish();
    ctl.finish();
    ctl.finish();

    expect(ctl.spoken).toEqual([
      'New order for T1.',
      'New order for T2.',
      'New order for T3.',
      'New order for T4.',
    ]);
    expect(queue.pending()).toBe(0);
  });

  it('keeps them in the order they arrived', () => {
    const { speaker, spoken } = immediate();
    const queue = createAnnounceQueue(speaker);

    for (const n of [5, 1, 9, 3, 7]) queue.push(`o${n}`, `order ${n}`);

    expect(spoken).toEqual(['order 5', 'order 1', 'order 9', 'order 3', 'order 7']);
  });

  it('does not announce the same key twice', () => {
    // The board re-reads every few seconds. Without this it would repeat
    // every open ticket on every poll and never stop talking.
    const { speaker, spoken } = immediate();
    const queue = createAnnounceQueue(speaker);

    expect(queue.push('o1', 'first time')).toBe(true);
    expect(queue.push('o1', 'first time')).toBe(false);
    expect(queue.push('o1', 'first time')).toBe(false);

    expect(spoken).toEqual(['first time']);
    expect(queue.has('o1')).toBe(true);
  });

  it('does not queue a duplicate that is still waiting', () => {
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    queue.push('o1', 'one');
    queue.push('o2', 'two');
    queue.push('o2', 'two'); // second poll, before 'two' has been spoken

    expect(queue.pending()).toBe(1);
    ctl.finish();
    ctl.finish();

    expect(ctl.spoken).toEqual(['one', 'two']);
  });

  it('announces again once a key is forgotten', () => {
    // Replay is a button on the board, and it has to work after the order
    // has already been announced once.
    const { speaker, spoken } = immediate();
    const queue = createAnnounceQueue(speaker);

    queue.push('o1', 'once');
    queue.forget('o1');
    queue.push('o1', 'twice');

    expect(spoken).toEqual(['once', 'twice']);
  });

  it('keeps working after a speaker throws', () => {
    // A speaker that throws must not wedge the queue. Silent failure here
    // looks exactly like the kitchen turning audio off.
    const spoken: string[] = [];
    let calls = 0;

    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        calls += 1;
        spoken.push(text);
        onEnd();
        if (calls === 1) throw new Error('audio device gone');
      },
    });

    // The throw is swallowed: the queue's job is to keep talking, and a
    // broken audio device on one announcement must not end the service.
    expect(() => queue.push('o1', 'first')).not.toThrow();
    queue.push('o2', 'second');

    expect(spoken).toEqual(['first', 'second']);
    expect(queue.pending()).toBe(0);
    expect(queue.speaking()).toBe(false);
  });
});

describe('newOrderText', () => {
  it('leads with the table and lists the dishes', () => {
    const text = newOrderText('T1', [
      { qty: 2, name: 'Butter Chicken' },
      { qty: 1, name: 'normal rice' },
    ]);
    // Quantities are words: a synthesised "2." hangs a pause on the digit and
    // the sentence arrives stilted.
    expect(text).toBe('New order, table T1. Two Butter Chicken. One normal rice.');
  });

  it('says the portion, because a Half plated as a Full loses money', () => {
    const text = newOrderText('T1', [
      { qty: 1, name: 'Butter Chicken', detail: 'Half' },
      { qty: 2, name: 'Butter Naan', detail: 'Full · Butter naan' },
    ]);
    expect(text).toBe(
      'New order, table T1. One Butter Chicken, Half. Two Butter Naan, Full, Butter naan.',
    );
  });

  it("reads the guest's note last, clearly marked", () => {
    const text = newOrderText('T3', [{ qty: 1, name: 'koko' }], 'no onion, less spicy');
    expect(text).toBe('New order, table T3. One koko. Note: no onion, less spicy.');
  });

  it('cuts a very long note instead of speaking a paragraph', () => {
    const text = newOrderText('T3', [{ qty: 1, name: 'koko' }], 'x'.repeat(400));
    expect(text.length).toBeLessThan(250);
    expect(text).toContain('…');
  });

  it('ignores a blank note rather than saying "Note: ."', () => {
    expect(newOrderText('T1', [{ qty: 1, name: 'koko' }], '   ')).not.toContain('Note');
  });

  it('calls a counter order a takeaway, not a table', () => {
    const text = newOrderText('Takeaway', [{ qty: 1, name: 'koko' }]);
    expect(text).toBe('New takeaway order. One koko.');
    expect(text).not.toContain('Takeaway.');
  });

  it('never mentions the order code', () => {
    // The pass carries plates to a table, not to a code. A code belongs on a
    // receipt, and a kitchen asked to remember one gets it wrong.
    const text = newOrderText('T1', [{ qty: 1, name: 'koko' }]);
    expect(text).not.toMatch(/MA-|code|[A-Z]{2}-[A-Z0-9]{5}/);
  });

  it('says something useful for an order with no lines', () => {
    expect(newOrderText('T1', [])).toBe('New order, table T1.');
  });
});

describe('advanceText', () => {
  it('names the table and the new state in a spoken sentence', () => {
    expect(advanceText('T1', 'ready')).toBe('Table T1 is ready.');
    expect(advanceText('T2', 'preparing')).toBe('Table T2, now preparing.');
  });
});

describe('summariseItems', () => {
  it('leaves a short order alone', () => {
    const items = [
      { qty: 1, name: 'a' },
      { qty: 2, name: 'b' },
    ];
    expect(summariseItems(items)).toEqual(items);
  });

  it('counts the remainder instead of reading a long order in full', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ qty: 1, name: `dish${i}` }));
    const out = summariseItems(items);

    expect(out).toHaveLength(MAX_SPOKEN_ITEMS + 1);
    expect(out.at(-1)).toEqual({ qty: 5, name: 'more items' });
  });

  it('still names the four dishes the cook needs first', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ qty: 2, name: `dish${i}` }));
    const text = newOrderText('T1', items);

    expect(text).toContain('dish0');
    expect(text).toContain('dish3');
    expect(text).not.toContain('dish4');
    expect(text).toContain('Four more items');
  });
});

describe('numberWord', () => {
  it('spells the counts a menu actually uses', () => {
    expect([1, 2, 3, 10, 20].map((n) => numberWord(n))).toEqual([
      'one',
      'two',
      'three',
      'ten',
      'twenty',
    ]);
  });

  it('leaves large counts as digits, which are clearer than a long phrase', () => {
    expect(numberWord(37)).toBe('37');
  });
});

describe('announcement priority', () => {
  it('never drops an order, however far behind the queue is', () => {
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    for (let i = 0; i < 12; i += 1) {
      // Simulate the backlog by never finishing the first utterance.
      queue.push(`o${i}`, `order ${i}`);
    }

    expect(queue.pending()).toBe(11);
  });

  it('drops a state-change announcement once the queue is backed up', () => {
    // Six queued tickets are more important than hearing that table two is
    // now preparing -- that is already on the screen.
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    // One is being spoken and MAX_BACKLOG are waiting: the board is already
    // describing the past.
    for (let i = 0; i < MAX_BACKLOG + 1; i += 1) queue.push(`o${i}`, `order ${i}`);
    expect(queue.pending()).toBe(MAX_BACKLOG);

    expect(queue.push('adv:o1:ready', 'Table T1 is ready.', 'info')).toBe(false);
  });

  it('takes a state-change announcement while the queue is short', () => {
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);
    expect(queue.push('adv:o1:ready', 'Table T1 is ready.', 'info')).toBe(true);
  });
});

describe('orderAnnouncement', () => {
  it('reads the note with the order, not as a separate ticket', () => {
    const text = orderAnnouncement({
      table: 'T2',
      note: 'no onion',
      items: [{ qty: 1, name: 'Butter Chicken', detail: 'Half' }],
    });

    expect(text).toBe('New order, table T2. One Butter Chicken, Half. Note: no onion.');
  });
});

describe('primeOnOpen', () => {
  const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
  const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

  const ticket = (id: string, minutes: number) => ({
    orderId: id,
    table: 'T1',
    placedAtIso: minutesAgo(minutes),
    items: [{ qty: 1, name: 'koko' }],
  });

  it('marks the whole board as seen, so opening it does not read out the afternoon', () => {
    const board = [ticket('a', 5), ticket('b', 90), ticket('c', 200)];
    const { seen } = primeOnOpen(board, [], NOW);

    expect(seen.sort()).toEqual(['a', 'b', 'c']);
  });

  it('offers only the last half hour to be read out', () => {
    // Six hours of open tickets is an ambush; the ten minutes before someone
    // walked in is work the pass may genuinely still need.
    const board = [ticket('a', 5), ticket('b', 45)];
    const { missed } = primeOnOpen(board, [], NOW);

    expect(missed.map((t) => t.orderId)).toEqual(['a']);
  });

  it('never re-offers a ticket already seen in a previous session', () => {
    const board = [ticket('a', 2), ticket('b', 3)];
    const { missed } = primeOnOpen(board, ['a'], NOW);

    expect(missed.map((t) => t.orderId)).toEqual(['b']);
  });

  it('ignores demo rows, which have no identity to remember', () => {
    const { seen, missed } = primeOnOpen([{ table: 'T1', items: [] }], [], NOW);
    expect(seen).toEqual([]);
    expect(missed).toEqual([]);
  });

  it('does not offer a ticket with an unreadable timestamp', () => {
    const { missed } = primeOnOpen(
      [{ orderId: 'x', table: 'T1', placedAtIso: 'not a date', items: [] }],
      [],
      NOW,
    );
    expect(missed).toEqual([]);
  });
});

describe('selectNewTickets', () => {
  it('returns only what has not been seen', () => {
    const board = [
      { orderId: 'a', table: 'T1', items: [] },
      { orderId: 'b', table: 'T2', items: [] },
    ];
    expect(selectNewTickets(board, ['a']).map((t) => t.orderId)).toEqual(['b']);
  });

  it('ignores rows with no id', () => {
    expect(selectNewTickets([{ table: 'T1', items: [] }], [])).toEqual([]);
  });
});


/* ========================================================================== */
/*  Hindi                                                                     */
/* ========================================================================== */

describe('Hindi announcements', () => {
  it('speaks the frame in Hindi and leaves the dish name as the menu writes it', () => {
    // An Indian kitchen says it exactly like this: the grammar is Hindi, the
    // dish is whatever the menu calls it. Translating "Butter Chicken" would
    // be inventing a name the pass does not recognise.
    const text = newOrderText('T1', [{ qty: 2, name: 'Butter Chicken', detail: 'Half' }], null, 'hi');

    expect(text).toBe('नया ऑर्डर, टेबल टी वन। दो Butter Chicken, आधा।');
  });

  it('reads the table label in Devanagari so any Hindi voice can say it', () => {
    // Devanagari synthesisers disagree about Latin letters: some read them,
    // some spell them out, some skip them. Mapping every character removes
    // the question.
    expect(spokenTable('T1', 'hi')).toBe('टी वन');
    // "T twelve", not "T one two" and not the Hindi numeral.
    expect(spokenTable('T12', 'hi')).toBe('टी ट्वेल्व');
    // A hotel's room number is said digit by digit: "Room two oh four".
    expect(spokenTable('Room 204', 'hi')).toBe('आर ओ ओ एम टू ज़ीरो फ़ोर');
  });

  it('keeps Latin labels untouched in English', () => {
    expect(spokenTable('T12', 'en')).toBe('T12');
  });

  it('calls a counter order a takeaway', () => {
    expect(spokenTable('Takeaway', 'hi')).toBe('टेकअवे');
    expect(newOrderText('Takeaway', [{ qty: 1, name: 'koko' }], null, 'hi')).toBe(
      'नया टेकअवे ऑर्डर। एक koko।',
    );
  });

  it('translates the portions a menu actually has', () => {
    const half = newOrderText('T2', [{ qty: 1, name: 'Biryani', detail: 'Half' }], null, 'hi');
    const full = newOrderText('T2', [{ qty: 1, name: 'Biryani', detail: 'Full' }], null, 'hi');
    const pav = newOrderText('T2', [{ qty: 1, name: 'Biryani', detail: 'Quarter' }], null, 'hi');

    expect(half).toContain('आधा');
    expect(full).toContain('पूरा');
    // Bombay menus call a quarter "paav"; the Hindi word for a quarter plate
    // in a restaurant is not "चौथाई".
    expect(pav).toContain('पाव');
  });

  it('passes an unknown portion through rather than guessing', () => {
    const text = newOrderText('T2', [{ qty: 1, name: 'Thali', detail: 'Jumbo' }], null, 'hi');
    expect(text).toContain('Jumbo');
  });

  it('reads the guest note in Hindi, last and marked', () => {
    const text = newOrderText('T3', [{ qty: 1, name: 'koko' }], 'no onion', 'hi');
    expect(text).toBe('नया ऑर्डर, टेबल टी थ्री। एक koko। नोट: no onion।');
  });

  it('counts a long order instead of reading it all out', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ qty: 1, name: `dish${i}` }));
    const text = newOrderText('T1', items, null, 'hi');

    expect(text).toContain('dish3');
    expect(text).not.toContain('dish4');
    expect(text).toContain('और तीन आइटम');
  });

  it('uses the Devanagari danda, which is what a Hindi voice pauses on', () => {
    const text = newOrderText('T1', [{ qty: 1, name: 'koko' }], null, 'hi');
    expect(text).toContain('।');
    expect(text).not.toContain('.');
  });

  it('never mentions the order code', () => {
    const text = newOrderText('T1', [{ qty: 1, name: 'koko' }], null, 'hi');
    expect(text).not.toMatch(/MA-/);
  });
});

describe('advanceText for a takeaway ticket', () => {
  it('does not invent a table called "takeaway"', () => {
    // "Table takeaway, now preparing" is not clumsy, it is wrong: a cook
    // listening for a table number hears one that does not exist.
    expect(advanceText('Takeaway', 'preparing')).toBe('The takeaway order is being prepared.');
    expect(advanceText('Takeaway', 'ready', 'hi')).toBe('टेकअवे ऑर्डर तैयार है।');
  });

  it('speaks the table in Hindi for a table ticket', () => {
    expect(advanceText('T2', 'ready', 'hi')).toBe('टेबल टी टू तैयार है।');
  });
});

describe('chooseLanguage', () => {
  it('uses Hindi when the device has a Hindi voice', () => {
    expect(chooseLanguage('hi', true)).toEqual({ lang: 'hi', fellBack: false });
  });

  it('falls back to English rather than reading Devanagari at an English voice', () => {
    // An English synthesiser given Devanagari produces silence or noise, and
    // reports success while doing it. Falling back is the only honest option,
    // and the board says so on screen.
    expect(chooseLanguage('hi', false)).toEqual({ lang: 'en', fellBack: true });
  });

  it('leaves an explicit English choice alone', () => {
    expect(chooseLanguage('en', false)).toEqual({ lang: 'en', fellBack: false });
    expect(chooseLanguage('en', true)).toEqual({ lang: 'en', fellBack: false });
  });
});

describe('force', () => {
  it('replays an announcement that is still waiting in the queue', () => {
    // The Replay button used to do nothing when pressed while the original
    // was still queued: push() refused it as a duplicate.
    const ctl = controllable();
    const queue = createAnnounceQueue(ctl.speaker);

    queue.push('o1', 'first');
    queue.push('o1', 'first'); // refused, as a poll would be

    expect(queue.force('o1', 'first again')).toBe(true);

    ctl.finish();
    ctl.finish();

    expect(ctl.spoken).toEqual(['first', 'first again']);
  });

  it('replays something already said', () => {
    const { speaker, spoken } = immediate();
    const queue = createAnnounceQueue(speaker);

    queue.push('o1', 'once');
    expect(queue.force('o1', 'twice')).toBe(true);

    expect(spoken).toEqual(['once', 'twice']);
  });
});

describe('language travels with the announcement', () => {
  it('hands the speaker the language the sentence was written in', () => {
    // A board lets someone switch language with tickets still waiting. If the
    // speaker looked up "the current language" at speak time, a queued Hindi
    // sentence would be read by an English voice -- which is silence.
    const heard: Array<string | undefined> = [];
    const queue = createAnnounceQueue({
      speak(_text, onEnd, lang) {
        heard.push(lang);
        onEnd();
      },
    });

    queue.push('o1', 'नया ऑर्डर।', 'order', 'hi');
    queue.push('o2', 'New order.', 'order', 'en');
    queue.force('o3', 'again', 'order', 'hi');

    expect(heard).toEqual(['hi', 'en', 'hi']);
  });

  it('leaves the language undefined when the caller never set one', () => {
    const heard: Array<string | undefined> = [];
    const queue = createAnnounceQueue({
      speak(_text, onEnd, lang) {
        heard.push(lang);
        onEnd();
      },
    });

    queue.push('o1', 'anything');
    expect(heard).toEqual([undefined]);
  });
});
