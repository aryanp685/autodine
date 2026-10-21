import { describe, expect, it } from 'vitest';
import {
  MAX_BACKLOG,
  MAX_SPOKEN_ITEMS,
  advanceText,
  announceLogLabel,
  createAnnounceQueue,
  isTakeaway,
  newOrderText,
  orderAnnouncement,
  primeOnOpen,
  selectNewTickets,
  spokenDetail,
  spokenItem,
  spokenTable,
  type SpeakableItem,
} from './announce';
import { isDevanagariOnly } from './hindi';

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
  it('reads a table label as a label, not as a quantity', () => {
    // "टेबल टी एक" is what a quantity table produces, and no one says it.
    expect(spokenTable('T1')).toBe('टी वन');
    expect(spokenTable('T2')).toBe('टी टू');
    expect(spokenTable('T12')).toBe('टी ट्वेल्व');
  });

  it('reads a long label digit by digit, the way a room number is said', () => {
    expect(spokenTable('Room 204')).toBe('आर ओ ओ एम टू ज़ीरो फ़ोर');
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
  it('says the quantity as a word, then the dish, then the portion', () => {
    expect(spokenItem({ qty: 2, name: 'Butter Naan', detail: 'Half' })).toBe('दो बटर नान, आधा');
  });

  it('says a Bombay quarter the way a kitchen says it', () => {
    expect(spokenItem({ qty: 1, name: 'Veg Biryani', detail: 'Quarter' })).toBe('एक वेज बिरयानी, पाव');
  });

  it('keeps add-ons, translated and in order', () => {
    expect(spokenDetail('Half · Extra cheese')).toBe('आधा, एक्स्ट्रा चीज़');
  });

  it('translates an add-on nobody has heard of instead of dropping it', () => {
    expect(isDevanagariOnly(spokenDetail('Peri Peri'))).toBe(true);
  });

  it('still says the dish when there is no portion', () => {
    expect(spokenItem({ qty: 3, name: 'Masala Dosa' })).toBe('तीन मसाला डोसा');
  });
});

describe('newOrderText', () => {
  it('says table first, dishes next, the guest note last', () => {
    const text = newOrderText('T1', [chicken], 'no onion');

    expect(text).toBe('नया ऑर्डर, टेबल टी वन। एक बटर चिकन, आधा, बटर नान। नोट, नो प्याज़।');
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

  it('marks the note as a note, so it is not mistaken for another dish', () => {
    expect(newOrderText('T3', [naan], 'no onion')).toContain('नोट, ');
  });

  it('omits the note clause entirely when there is none', () => {
    expect(newOrderText('T3', [naan])).not.toContain('नोट');
    expect(newOrderText('T3', [naan], '   ')).not.toContain('नोट');
  });

  it('speaks a takeaway ticket without inventing a table', () => {
    const text = newOrderText('Takeaway', [naan]);
    expect(text.startsWith('नया टेकअवे ऑर्डर।')).toBe(true);
    expect(text).not.toContain('टेबल');
  });

  it('counts what it does not read out instead of dropping it silently', () => {
    const items: SpeakableItem[] = Array.from({ length: 7 }, (_, i) => ({
      qty: 1,
      name: `Dish ${i + 1}`,
    }));

    const text = newOrderText('T5', items);
    // Four dishes, then "and three items" -- in words, in Devanagari.
    expect(text).toContain('और तीन आइटम');
    expect(text.split('।').filter((clause) => clause.includes('डिश')).length).toBeLessThanOrEqual(MAX_SPOKEN_ITEMS + 1);
  });

  it('cuts a note that would take longer to say than the ticket took to cook', () => {
    const text = newOrderText('T5', [naan], 'a'.repeat(400));
    expect(text.length).toBeLessThan(400);
    expect(text).toContain('…');
  });
});

describe('advanceText', () => {
  it('says which table moved on', () => {
    expect(advanceText('T2', 'preparing')).toBe('टेबल टी टू, बनना शुरू।');
    expect(advanceText('T2', 'ready')).toBe('टेबल टी टू तैयार है।');
    expect(advanceText('T2', 'served')).toBe('टेबल टी टू सर्व हो गया।');
  });

  it('does not read out "table takeaway"', () => {
    expect(advanceText('Takeaway', 'preparing')).toBe('टेकअवे ऑर्डर बन रहा है।');
    expect(advanceText('Takeaway', 'ready')).toBe('टेकअवे ऑर्डर तैयार है।');
  });

  it('degrades to a real sentence for a state it does not know', () => {
    expect(advanceText('T4', 'cancelled')).toBe('टेबल टी फ़ोर, कैंसल।');
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
      onEnd();
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
        onEnd();
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

    expect(queue.push('o1', 'एक।')).toBe(true);
    expect(queue.push('o1', 'एक।')).toBe(false);
    expect(heard).toEqual(['एक।']);
  });

  it('does not queue the same sentence twice while it is still waiting', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        setTimeout(onEnd, 0);
      },
    });

    queue.push('now', 'अभी।'); // speaking
    expect(queue.push('a', 'नया ऑर्डर, टेबल टी वन।')).toBe(true);
    expect(queue.push('b', 'नया ऑर्डर, टेबल टी वन।')).toBe(false);
    expect(queue.pending()).toBe(1);
  });

  it('replays on request, even while the original is still waiting', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        setTimeout(onEnd, 0);
      },
    });

    queue.push('o1', 'एक।'); // speaking now
    queue.push('o2', 'दो।'); // waiting

    // Replay of the waiting one must replace it, not be refused.
    expect(queue.force('o2', 'दो।')).toBe(true);
    expect(queue.pending()).toBe(1);
  });

  it('keeps the backlog bounded for state changes but never for orders', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        setTimeout(onEnd, 0);
      },
    });

    queue.push('now', 'अभी।'); // occupies the speaker

    for (let i = 0; i < MAX_BACKLOG + 3; i += 1) {
      queue.push(`info${i}`, `जानकारी ${i}।`, 'info');
    }

    // Every order still gets in, because an unannounced ticket is a cold plate.
    expect(queue.push('order', 'ऑर्डर।')).toBe(true);
    expect(queue.pending()).toBeLessThanOrEqual(MAX_BACKLOG + 1);
  });

  it('survives a speaker that calls back twice', () => {
    let running = 0;
    let overlap = false;
    const queue = createAnnounceQueue({
      speak(_text, onEnd) {
        running += 1;
        if (running > 1) overlap = true;
        onEnd();
        onEnd(); // some engines fire both onend and onerror
        running -= 1;
      },
    });

    queue.push('a', 'एक।');
    queue.push('b', 'दो।');

    expect(overlap).toBe(false);
  });

  it('does not wedge when the speaker throws', () => {
    const heard: string[] = [];
    const queue = createAnnounceQueue({
      speak(text, onEnd) {
        heard.push(text);
        if (text === 'बुरा।') throw new Error('engine died');
        onEnd();
      },
    });

    queue.push('a', 'बुरा।');
    queue.push('b', 'ठीक।');

    expect(heard).toEqual(['बुरा।', 'ठीक।']);
  });

  it('refuses empty text rather than speaking silence', () => {
    const { queue, heard } = recorder();
    expect(queue.push('a', '   ')).toBe(false);
    expect(heard).toEqual([]);
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
