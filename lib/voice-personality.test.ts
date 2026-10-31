import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildExpressiveAnnouncement,
  buildKitchenAnnouncement,
  decideStyle,
  nextVariationIndex,
  resetVariationCounter,
  getVariationCounter,
  PERSONALITY_VARIATIONS,
} from './voice-personality';
import type { SpeakableItem } from './announce';

/**
 * Kitchen voice personality tests.
 *
 * These test the expressive text generation: that order data (table, dishes,
 * quantities, notes) is always preserved accurately, that expressive framing
 * does not corrupt it, that safety-critical notes trigger the standard style,
 * and that variations rotate so the voice does not sound like a loop.
 */

const SAMPLE_ITEMS: SpeakableItem[] = [
  { qty: 2, name: 'Paneer Tikka' },
  { qty: 1, name: 'Butter Naan' },
];

describe('buildExpressiveAnnouncement', () => {
  it('includes the table number in the opener', () => {
    const text = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0);
    expect(text).toContain('टेबल');
    expect(text).toContain('पाँच');
  });

  it('includes every dish with its quantity', () => {
    const text = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0);
    expect(text).toContain('दो'); // hindiNumber(2)
    expect(text).toContain('एक'); // hindiNumber(1)
    expect(text).toContain('पनीर');
    expect(text).toContain('बटर');
  });

  it('includes the guest note when present', () => {
    const text = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, 'no onion', 0);
    expect(text).toContain('प्याज़');
  });

  it('does not include a note section when note is null', () => {
    const withNote = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, 'no onion', 0);
    const noNote = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0);
    // The note text should appear in the withNote version but not in noNote
    expect(withNote).toContain('प्याज़');
    expect(noNote).not.toContain('प्याज़');
  });

  it('handles takeaway orders', () => {
    const text = buildExpressiveAnnouncement('Takeaway', SAMPLE_ITEMS, null, 0);
    expect(text).toContain('टेकअवे');
    expect(text).not.toContain('टेबल');
  });

  it('uses expressive punctuation for natural pacing', () => {
    const text = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0);
    // Expressive text should use exclamation marks and ellipses for pacing
    expect(text).toMatch(/[!।]/);
  });

  it('preserves dish names exactly through spokenItem', () => {
    const items: SpeakableItem[] = [
      { qty: 1, name: 'Dal Makhani' },
      { qty: 3, name: 'Butter Naan' },
    ];
    const text = buildExpressiveAnnouncement('5', items, null, 0);
    // The dish names should appear in the text
    expect(text).toContain('दाल');
    expect(text).toContain('नान');
  });

  it('does not invent menu items or quantities', () => {
    const items: SpeakableItem[] = [
      { qty: 1, name: 'Chicken Tikka' },
    ];
    const text = buildExpressiveAnnouncement('5', items, null, 0);
    // Should not contain items not in the order
    expect(text).not.toContain('पनीर');
    expect(text).not.toContain('دال');
    expect(text).not.toContain('टनka');
  });

  it('returns different text for different variations', () => {
    const v0 = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0);
    const v1 = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 1);
    const v2 = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 2);
    const v3 = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 3);
    const v4 = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 4);

    // All should contain the order data
    for (const text of [v0, v1, v2, v3, v4]) {
      expect(text).toContain('पाँच');
    }

    // But the expressive framing should differ
    const unique = new Set([v0, v1, v2, v3, v4]);
    expect(unique.size).toBeGreaterThan(2);
  });

  it('wraps around variation index modulo length', () => {
    const v0 = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0);
    const v5 = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 5); // 5 % 5 = 0
    expect(v0).toBe(v5);
  });
});

describe('buildKitchenAnnouncement', () => {
  beforeEach(() => {
    resetVariationCounter();
  });

  it('generates a complete announcement', () => {
    const text = buildKitchenAnnouncement('5', SAMPLE_ITEMS, null);
    expect(text.length).toBeGreaterThan(20);
    expect(text).toContain('पाँच');
  });

  it('rotates variations on consecutive calls', () => {
    resetVariationCounter();
    const t1 = buildKitchenAnnouncement('5', SAMPLE_ITEMS, null);
    const t2 = buildKitchenAnnouncement('5', SAMPLE_ITEMS, null);
    const t3 = buildKitchenAnnouncement('5', SAMPLE_ITEMS, null);

    // Should not all be the same
    const unique = new Set([t1, t2, t3]);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('uses standard style for safety-critical notes', () => {
    resetVariationCounter();
    const text = buildKitchenAnnouncement('5', SAMPLE_ITEMS, 'no onion, no garlic');
    // Standard style should not use Nagpuri slang
    expect(text).not.toContain('गुरु');
    expect(text).not.toContain('माय रे');
    // But should still include the note clearly
    expect(text).toContain('प्याज़');
  });

  it('keeps every joke out of safety announcements', () => {
    resetVariationCounter();
    const text = buildKitchenAnnouncement('5', SAMPLE_ITEMS, 'no onion, no garlic');
    // The personality lives in the expressive framing (vocatives, "hunger
    // waits for no one"). A safety note is plain clear Hindi end to end —
    // a joke or a slang word must never ride along with an allergy.
    for (const quip of [
      'जादू', 'फरमाइश', 'भूख', 'वाह', 'फरमान', 'हुक्म', 'पटकन', 'बापरे', 'कमाल',
      'गुरु', 'माय रे', 'बाप रे', 'झकास', 'रौनक', 'छा गया', 'दादा', 'फटाफट', 'का माँगा', 'सुन ले',
    ]) {
      expect(text).not.toContain(quip);
    }
  });

  it('joins dishes the way a person reads a list — commas, then "and"', () => {
    const text = buildExpressiveAnnouncement(
      '5',
      [
        { qty: 2, name: 'Paneer Tikka' },
        { qty: 1, name: 'Butter Naan' },
        { qty: 3, name: 'Cold Drink' },
      ],
      null,
      0,
    );
    // "दो पनीर टिक्का, एक बटर नान और तीन ठंडा ड्रिन्क" — the "और"
    // before the last dish gives the voice a natural list contour.
    expect(text).toContain('पनीर टिक्का, एक बटर नान और तीन ठंडा ड्रिन्क');
  });

  it('uses expressive style for non-safety notes', () => {
    resetVariationCounter();
    const text = buildKitchenAnnouncement('5', SAMPLE_ITEMS, 'extra cheese');
    // Should be expressive (may contain slang)
    expect(text.length).toBeGreaterThan(20);
  });

  it('uses expressive style when no note', () => {
    resetVariationCounter();
    const text = buildKitchenAnnouncement('5', SAMPLE_ITEMS, null);
    expect(text.length).toBeGreaterThan(20);
  });
});

describe('decideStyle', () => {
  it('returns expressive for empty note', () => {
    expect(decideStyle(null)).toBe('expressive');
    expect(decideStyle(undefined)).toBe('expressive');
    expect(decideStyle('')).toBe('expressive');
  });

  it('returns expressive for non-safety notes', () => {
    expect(decideStyle('on the side')).toBe('expressive');
    expect(decideStyle('cutlery please')).toBe('expressive');
  });

  it('returns standard for allergy keywords', () => {
    expect(decideStyle('no onion')).toBe('standard');
    expect(decideStyle('no garlic')).toBe('standard');
    expect(decideStyle('allergic to nuts')).toBe('standard');
    expect(decideStyle('no gluten')).toBe('standard');
  });

  it('returns standard for substitution keywords', () => {
    expect(decideStyle('no cheese')).toBe('standard');
    expect(decideStyle('less spicy')).toBe('standard');
    expect(decideStyle('extra spicy')).toBe('standard');
  });

  it('returns standard for dietary restriction keywords', () => {
    expect(decideStyle('vegan')).toBe('standard');
    expect(decideStyle('vegetarian')).toBe('standard');
    expect(decideStyle('halal')).toBe('standard');
  });

  it('returns standard for quantity-modifying keywords', () => {
    expect(decideStyle('extra cheese')).toBe('standard');
    expect(decideStyle('no onion, no garlic')).toBe('standard');
  });
});

describe('nextVariationIndex', () => {
  beforeEach(() => {
    resetVariationCounter();
  });

  it('returns 0 on first call', () => {
    expect(nextVariationIndex()).toBe(0);
  });

  it('returns 1 on second call', () => {
    nextVariationIndex();
    expect(nextVariationIndex()).toBe(1);
  });

  it('returns 2 on third call', () => {
    nextVariationIndex();
    nextVariationIndex();
    expect(nextVariationIndex()).toBe(2);
  });

  it('wraps around after all variations', () => {
    for (let i = 0; i < PERSONALITY_VARIATIONS.length; i++) {
      nextVariationIndex();
    }
    // Counter should be back to 0
    expect(getVariationCounter()).toBe(0);
    expect(nextVariationIndex()).toBe(0);
  });

  it('returns standard index when style is standard', () => {
    const stdIndex = PERSONALITY_VARIATIONS.findIndex(
      (v) => v.id === 'standard',
    );
    expect(stdIndex).toBeGreaterThanOrEqual(0);

    // Regardless of counter position, standard style returns the standard index
    resetVariationCounter();
    nextVariationIndex(); // counter = 1
    nextVariationIndex(); // counter = 2
    expect(nextVariationIndex('standard')).toBe(stdIndex);
  });

  it('counter advances even for standard style', () => {
    resetVariationCounter();
    nextVariationIndex('standard');
    expect(getVariationCounter()).toBe(1);
  });
});

describe('PERSONALITY_VARIATIONS', () => {
  it('has at least 4 variations', () => {
    expect(PERSONALITY_VARIATIONS.length).toBeGreaterThanOrEqual(4);
  });

  it('includes a standard variation', () => {
    const hasStandard = PERSONALITY_VARIATIONS.some(
      (v) => v.id === 'standard',
    );
    expect(hasStandard).toBe(true);
  });

  it('all variations have unique IDs', () => {
    const ids = PERSONALITY_VARIATIONS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('standard variation uses plain Hindi with no slang', () => {
    const standard = PERSONALITY_VARIATIONS.find(
      (v) => v.id === 'standard',
    )!;
    const text = standard.opener('5');
    expect(text).not.toContain('अरे');
    expect(text).not.toContain('माम');
    expect(text).not.toContain('भाई');
    expect(text).not.toContain('रे');
  });

  it('every variation says only the order — no slang, no chatter', () => {
    for (const variation of PERSONALITY_VARIATIONS) {
      const opener = variation.opener('5');
      expect(opener).toContain('ऑर्डर');
      // No personality, no jokes, no calls to action — the announcement
      // is the order and the note, nothing else.
      for (const chatter of [
        'अरे', 'गुरु', 'मान,', 'भाई', 'शुरू कर', 'भूख', 'इंतज़ार', 'मेहमान',
        'कृपया', 'फटाफट', 'रौनक', 'झकास', 'जादू', 'फरमाइश', 'फरमान', 'हुक्म',
      ]) {
        expect(opener).not.toContain(chatter);
      }
    }
  });

  it('says nothing beyond the order and the note', () => {
    for (const variation of PERSONALITY_VARIATIONS) {
      const text = buildExpressiveAnnouncement(
        '5',
        SAMPLE_ITEMS,
        'no onion, no garlic',
        PERSONALITY_VARIATIONS.indexOf(variation),
      );
      for (const chatter of [
        'अरे', 'गुरु', 'शुरू कर', 'भूख', 'इंतज़ार', 'मेहमान', 'कृपया',
        'फटाफट', 'रौनक', 'झकास', 'ऐसा ही बनाना', 'जल्दी',
      ]) {
        expect(text).not.toContain(chatter);
      }
      // Order, dishes, note — and nothing after the note.
      expect(text).toContain('ऑर्डर');
      expect(text).toContain('पनीर');
      expect(text.indexOf('नोट')).toBeGreaterThan(text.indexOf('नान'));
      expect(text.trimEnd().endsWith('।')).toBe(true);
    }
  });
});

describe('order data integrity', () => {
  it('does not modify dish quantities', () => {
    const items: SpeakableItem[] = [
      { qty: 5, name: 'Paneer Tikka' },
    ];
    const text = buildExpressiveAnnouncement('5', items, null, 0);
    // 5 should appear as the quantity
    expect(text).toContain('पाँच');
  });

  it('does not modify dish names', () => {
    const items: SpeakableItem[] = [
      { qty: 1, name: 'Biryani' },
    ];
    const text = buildExpressiveAnnouncement('5', items, null, 0);
    expect(text).toContain('बिरयानी');
  });

  it('does not modify table numbers', () => {
    const text = buildExpressiveAnnouncement('12', SAMPLE_ITEMS, null, 0);
    expect(text).toContain('बारह');
  });

  it('does not modify the note content', () => {
    const text = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, 'no onion and no garlic', 0);
    expect(text).toContain('प्याज़');
    expect(text).toContain('लहसुन');
  });

  it('does not add extra items to the order', () => {
    const items: SpeakableItem[] = [
      { qty: 1, name: 'Roti' },
    ];
    const text = buildExpressiveAnnouncement('5', items, null, 0);
    // Should not contain items not in the order
    expect(text).not.toContain('पनीर');
    expect(text).not.toContain('चिकन');
    expect(text).not.toContain('बिरयानी');
  });

  it('handles empty items array', () => {
    const text = buildExpressiveAnnouncement('5', [], null, 0);
    expect(text.length).toBeGreaterThan(0);
  });

  it('handles complex dish details', () => {
    const items: SpeakableItem[] = [
      { qty: 1, name: 'Butter Naan', detail: 'Half · Extra cheese' },
    ];
    const text = buildExpressiveAnnouncement('5', items, null, 0);
    expect(text).toContain('हाफ'); // half (Hinglish form)
    expect(text).toContain('एक्स्ट्रा'); // extra cheese
  });
});

/**
 * The desi dialects: Nagpuri (default) and Mumbai.
 *
 * Same facts either way -- which table, that a new order arrived -- said the
 * way the room actually talks. What a dialect may NOT do is add words: the
 * banned list below runs against both.
 */
describe('desi dialects', () => {
  const CHATTER = [
    'अरे', 'गुरु', 'मान,', 'भाई', 'माम', 'रे', 'शुरू कर', 'भूख', 'इंतज़ार', 'मेहमान',
    'कृपया', 'फटाफट', 'रौनक', 'झकास', 'जादू', 'फरमाइश', 'फरमान', 'हुक्म', 'यार',
  ];

  it('says "टेबल नंबर दो" for the printed card label T2', () => {
    // The kitchen said the old spelling sounded like "t2". The T on the card
    // is the word "table"; the sentence already says टेबल नंबर, so only the
    // number is spoken -- as the Hindi word.
    const text = buildExpressiveAnnouncement('T2', SAMPLE_ITEMS, null, 0);
    expect(text).toContain('टेबल नंबर दो');
    expect(text).not.toContain('टी दो');
    expect(buildKitchenAnnouncement('T2', SAMPLE_ITEMS, null, 'mumbai')).toContain(
      'टेबल नंबर दो',
    );
  });

  it('offers Nagpuri and Mumbai, and they say the same facts differently', () => {
    const nagpuri = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0, 'nagpuri');
    const mumbai = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0, 'mumbai');

    expect(nagpuri).not.toBe(mumbai);
    for (const text of [nagpuri, mumbai]) {
      expect(text).toContain('पाँच');
      expect(text).toContain('ऑर्डर');
      expect(text).toContain('पनीर');
    }
    expect(nagpuri).toContain('नवा');
    expect(nagpuri).toContain('आय');
    expect(mumbai).toContain('आ गया');
  });

  it('defaults to Nagpuri when no dialect is given', () => {
    expect(buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0)).toBe(
      buildExpressiveAnnouncement('5', SAMPLE_ITEMS, null, 0, 'nagpuri'),
    );
  });

  it('every dialect variation says only the order — no slang, no chatter', () => {
    for (const dialect of ['nagpuri', 'mumbai'] as const) {
      for (const variation of PERSONALITY_VARIATIONS) {
        const opener = variation.opener('5', dialect);
        expect(opener).toContain('ऑर्डर');
        for (const chatter of CHATTER) {
          expect(opener).not.toContain(chatter);
        }
      }
    }
  });

  it('says nothing beyond the order and the note, in either dialect', () => {
    for (const dialect of ['nagpuri', 'mumbai'] as const) {
      for (const variation of PERSONALITY_VARIATIONS) {
        const text = buildExpressiveAnnouncement(
          '5',
          SAMPLE_ITEMS,
          'no onion, no garlic',
          PERSONALITY_VARIATIONS.indexOf(variation),
          dialect,
        );
        for (const chatter of CHATTER) {
          expect(text).not.toContain(chatter);
        }
        expect(text.indexOf('नोट')).toBeGreaterThan(text.indexOf('नान'));
        expect(text.trimEnd().endsWith('।')).toBe(true);
      }
    }
  });

  it('reads a safety note in plain Hindi whatever the dialect', () => {
    // The safety voice is the one place flavour gives way to clarity: an
    // allergy note is framed identically in every room.
    const nagpuri = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, 'no onion', 4, 'nagpuri');
    const mumbai = buildExpressiveAnnouncement('5', SAMPLE_ITEMS, 'no onion', 4, 'mumbai');
    expect(nagpuri).toBe(mumbai);
  });

  it('rotates to a different phrase each ticket, in each dialect', () => {
    for (const dialect of ['nagpuri', 'mumbai'] as const) {
      const texts = [0, 1, 2, 3].map((index) =>
        buildExpressiveAnnouncement('T2', SAMPLE_ITEMS, null, index, dialect),
      );
      expect(new Set(texts).size).toBe(4);
    }
  });
});
