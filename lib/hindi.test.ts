import { describe, expect, it } from 'vitest';
import {
  hindiNumber,
  isDevanagariOnly,
  noteToDevanagari,
  spokenName,
  toDevanagari,
  transliterate,
  unknownWords,
} from './hindi';

/**
 * Devanagari for the voice.
 *
 * The rule these tests exist for: after toDevanagari() there is not one Latin
 * letter left. A hi-IN engine that silently skips Latin text is common enough
 * on cheap tablets that any Latin run is a dish name the kitchen never hears.
 */

describe('hindiNumber', () => {
  it('has a word for every number a ticket can carry', () => {
    expect(hindiNumber(1)).toBe('एक');
    expect(hindiNumber(2)).toBe('दो');
    expect(hindiNumber(4)).toBe('चार');
    expect(hindiNumber(20)).toBe('बीस');
    expect(hindiNumber(25)).toBe('पच्चीस');
    expect(hindiNumber(47)).toBe('सैंतालीस');
    expect(hindiNumber(99)).toBe('निन्यानवे');
  });

  it('reads a large count digit by digit rather than inventing a phrase', () => {
    expect(hindiNumber(125)).toBe('एक दो पाँच');
  });

  it('never returns nonsense for a value it cannot express', () => {
    expect(hindiNumber(0)).toBe('शून्य');
    expect(hindiNumber(2.4)).toBe('दो');
    expect(hindiNumber(-1)).toBe('-1');
  });
});

describe('translating a menu into Devanagari', () => {
  it('knows the dishes Indian kitchens actually cook', () => {
    expect(toDevanagari('Butter Chicken')).toBe('बटर चिकन');
    expect(toDevanagari('Paneer Tikka')).toBe('पनीर टिक्का');
    expect(toDevanagari('Masala Dosa')).toBe('मसाला डोसा');
    expect(toDevanagari('Hyderabadi Chicken Biryani')).toBe('हैदराबादी चिकन बिरयानी');
    expect(toDevanagari('Pav Bhaji')).toBe('पाव भाजी');
  });

  it('matches the longest phrase, so a dish is one name and not two words', () => {
    // "butter naan" is whole; a word-by-word pass would also work here, but
    // "gulab jamun" would not -- जामुन on its own is a fruit.
    expect(toDevanagari('Butter Naan')).toBe('बटर नान');
    expect(toDevanagari('Gulab Jamun')).toBe('गुलाब जामुन');
  });

  it('turns digits into words, so a quantity cannot be misread', () => {
    expect(toDevanagari('2 Butter Naan')).toBe('दो बटर नान');
    expect(toDevanagari('12 plates')).toBe('बारह प्लेट');
  });

  it('leaves Devanagari exactly as the restaurant wrote it', () => {
    expect(toDevanagari('पाव भाजी')).toBe('पाव भाजी');
    expect(toDevanagari('मिसळ पाव')).toBe('मिसळ पाव');
  });

  it('translates a dish nobody has heard of rather than dropping it', () => {
    const out = toDevanagari('Chicken Lollipop');
    expect(out).toBe('चिकन लोलीपॉप');
    expect(isDevanagariOnly(out)).toBe(true);
  });

  it('says the pizza names the way an Indian kitchen says them', () => {
    // The rules produce मैर्घेरिटा for this, which nobody can recognise.
    expect(toDevanagari('Margherita Pizza')).toBe('मार्गेरिटा पिज़्ज़ा');
    expect(toDevanagari('Pepperoni')).toBe('पेपरोनी');
    expect(toDevanagari('Farmhouse Pizza')).toBe('फ़ार्महाउस पिज़्ज़ा');
  });

  it('translates the guest note, which the guest typed in their own script', () => {
    expect(toDevanagari('no onion')).toBe('नो प्याज़');
    expect(isDevanagariOnly(toDevanagari('no onion, less spicy please'))).toBe(true);
  });

  it('never leaves a Latin letter behind, whatever the menu says', () => {
    const menus = [
      'Butter Chicken',
      'Quesadilla',
      'Tiramisu',
      'Cappuccino',
      'Mozzarella Sticks',
      'Peri Peri Fries',
      'Brownie with ice cream',
      'Schezwan Chowmein',
      'Alfredo Pasta',
      'Mojito',
      'XYZ123 unknown dish',
      'Room 204',
      'زعتر',
    ];

    for (const menu of menus) {
      expect(isDevanagariOnly(toDevanagari(menu))).toBe(true);
    }
  });
});

describe('transliterate', () => {
  it('applies the rules that actually change the sound', () => {
    // Silent final e, magic e, c before a soft vowel, "ow".
    expect(transliterate('coke')).toBe('कोक');
    expect(transliterate('cake')).toBe('केक');
    expect(transliterate('brownie')).toBe('ब्राउनी');
    expect(transliterate('fried')).toBe('फ़्राइड');

    // A consonant cluster is not a magic-e word -- and 'maple syrup' is in the
    // dictionary anyway, which is where a word that matters belongs.
    expect(toDevanagari('maple syrup')).toBe('मेपल सिरप');
  });

  it('returns something for input it cannot parse rather than nothing', () => {
    expect(transliterate('')).toBe('');
    expect(transliterate('123')).toBe('123');
    expect(transliterate('x')).not.toBe('');
  });
});

describe('unknownWords', () => {
  it('reports nothing for a name it knows word for word', () => {
    expect(unknownWords('Butter Chicken')).toEqual([]);
    expect(unknownWords('पाव भाजी')).toEqual([]);
  });

  it('names the words it had to guess, so they can be corrected', () => {
    // "Shawarma" is a real menu word this build does not know yet -- that is
    // the case this list exists for, not a word the dictionary already covers.
    expect(unknownWords('Shawarma')).toEqual(['Shawarma']);
    expect(unknownWords('Paneer Shawarma')).toEqual(['Shawarma']);
  });

  it('does not report the same word twice', () => {
    expect(unknownWords('Shawarma Shawarma')).toEqual(['Shawarma']);
  });
});

describe('spokenName', () => {
  it('uses the owner\'s pronunciation when there is one', () => {
    expect(spokenName('Butter Chicken', 'बटर चिकन स्पेशल')).toBe('बटर चिकन स्पेशल');
  });

  it('falls back to the menu name when the override is empty', () => {
    expect(spokenName('Butter Chicken', '')).toBe('बटर चिकन');
    expect(spokenName('Butter Chicken', null)).toBe('बटर चिकन');
    expect(spokenName('Butter Chicken', '   ')).toBe('बटर चिकन');
  });

  it('converts an override typed in Latin, so no Latin ever reaches the voice', () => {
    expect(isDevanagariOnly(spokenName('Butter Chicken', 'batata vada'))).toBe(true);
  });
});

describe('noteToDevanagari', () => {
  it('puts the negation where Hindi puts it', () => {
    expect(noteToDevanagari('no onion')).toBe('प्याज़ नहीं');
    expect(noteToDevanagari('no onions, no garlic')).toBe('प्याज़ नहीं, लहसुन नहीं');
  });

  it('says a quantity as an instruction, not a label', () => {
    // "ज़्यादा चीज़" said more of what; it did not say what to do with it.
    // The guest's own example: "extra butter" is "बटर ज़्यादा डालना" -- add
    // more butter -- and "more spicy" is "तीखा बनाना" -- make it spicy.
    expect(noteToDevanagari('extra butter')).toBe('बटर ज़्यादा डालना');
    expect(noteToDevanagari('more butter')).toBe('बटर ज़्यादा डालना');
    expect(noteToDevanagari('extra cheese')).toBe('चीज़ ज़्यादा डालना');
    expect(noteToDevanagari('less oil')).toBe('तेल थोड़ा कम डालना');
    expect(noteToDevanagari('less spicy')).toBe('तीखा थोड़ा कम रखना');
  });

  it('says a serving as giving more, not adding in', () => {
    // Something that arrives on the plate is देना (give): "extra roti" is
    // "रोटी ज़्यादा देना". Only what goes IN the dish is डालना.
    expect(noteToDevanagari('extra roti')).toBe('रोटी ज़्यादा देना');
    expect(noteToDevanagari('more water')).toBe('वाटर ज़्यादा देना');
  });

  it('keeps a dish name whole when the quantity sizes the serving', () => {
    // "extra paneer tikka" is more of the dish the dictionary knows as
    // पनीर टिक्का -- not paneer to add to a tikka.
    expect(noteToDevanagari('extra paneer tikka')).toBe('ज़्यादा पनीर टिक्का');
    expect(noteToDevanagari('extra butter naan')).toBe('ज़्यादा बटर नान');
    expect(noteToDevanagari('no butter chicken')).toBe('बटर चिकन नहीं');
  });

  it('says a quality word as making it so', () => {
    expect(noteToDevanagari('more crispy')).toBe('कुरकुरा बनाना');
    expect(noteToDevanagari('make it crispy')).toBe('कुरकुरा बनाना');
    expect(noteToDevanagari('more spicy please')).toBe('तीखा बनाना');
    expect(noteToDevanagari("don't add onion")).toBe('प्याज़ मत डालना');
    expect(noteToDevanagari('no more butter')).toBe('बटर और नहीं');
  });

  it('handles "without", which is a different word order again', () => {
    expect(noteToDevanagari('without butter')).toBe('बटर के बिना');
  });

  it('renders whole phrases as instructions, not transliterated sounds', () => {
    // "on the side" spoken as "ऑन थे साइड" is gibberish in Hindi — a note
    // is an instruction a cook can act on, so it is phrased as one.
    expect(noteToDevanagari('on the side')).toBe('अलग से देना है');
    expect(noteToDevanagari('extra spicy')).toBe('तीखा ज़्यादा रखना');
    expect(noteToDevanagari('pack separately')).toBe('अलग से पैक करना');
    expect(noteToDevanagari('asap')).toBe('जल्दी करना है');
  });

  it('says "more spicy" the way the kitchen says it — तीखा बनाना', () => {
    // The most common note there is. Without the whole-phrase rule the word
    // level produced "ज़्यादा स्पाइसी" — sounds, not an instruction.
    expect(noteToDevanagari('more spicy')).toBe('तीखा बनाना');
    expect(noteToDevanagari('MORE SPICY')).toBe('तीखा बनाना');
    expect(noteToDevanagari('spicy')).toBe('तीखा बनाना');
    expect(noteToDevanagari('not spicy')).toBe('तीखा नहीं');
  });

  it('translates a note it does not recognise rather than dropping it', () => {
    const out = noteToDevanagari('birthday cake');
    expect(isDevanagariOnly(out)).toBe(true);
    expect(out).toContain('केक');
  });
});

describe('the mispronunciations that were reported', () => {
  it('says normal as नॉर्मल, not नोरमाल', () => {
    // "नोरमाल" is read out as "normaal" -- long o, long a. Both were wrong.
    expect(toDevanagari('normal')).toBe('नॉर्मल');
    expect(toDevanagari('Normal')).toBe('नॉर्मल');
  });

  it('does not stretch a short English vowel', () => {
    expect(toDevanagari('total')).toBe('टोटल');
    expect(toDevanagari('cap')).toBe('कैप');
    expect(toDevanagari('bottle')).toBe('बोतल');
  });

  it('keeps English menu words out of the rules entirely', () => {
    const cases: [string, string][] = [
      ['Family Pack', 'फ़ैमिली पैक'],
      ['Jumbo Combo', 'जंबो कॉम्बो'],
      ['Crispy Corn', 'क्रिस्पी कॉर्न'],
      ['Grilled Chicken', 'ग्रिल्ड चिकन'],
      ['Chocolate Pudding', 'चॉकलेट पुडिंग'],
      ['Kids Meal', 'किड्स मील'],
    ];

    for (const [input, expected] of cases) expect(toDevanagari(input)).toBe(expected);
  });
});
