import { describe, expect, it } from 'vitest';
import { noteToEnglish } from './english';

/**
 * The English twin of the Hindi note contract (lib/hindi.test.ts).
 *
 * A note becomes what a cook is told to DO -- never a label, never word-for-
 * word mush. The user's own pins set the tone: "extra spicy" is said "make
 * extra spicy", and "less spicy" is said "less spicy".
 */
describe('noteToEnglish', () => {
  it('says a quality note as an instruction to make it', () => {
    expect(noteToEnglish('extra spicy')).toBe('Make extra spicy');
    expect(noteToEnglish('more spicy')).toBe('Make more spicy');
  });

  it('says a reduction the way the guest wrote it', () => {
    // "less spicy" is already the instruction; adding a verb would say more
    // than the guest asked for.
    expect(noteToEnglish('less spicy')).toBe('Less spicy');
  });

  it('adds things that go in the dish, and serves things on the plate', () => {
    expect(noteToEnglish('extra butter')).toBe('Add extra butter');
    expect(noteToEnglish('more onion')).toBe('Add more onion');
    expect(noteToEnglish('extra roti')).toBe('Serve extra roti');
    expect(noteToEnglish('less rice')).toBe('Serve less rice');
  });

  it('says a quality word alone as "make it"', () => {
    expect(noteToEnglish('spicy')).toBe('Make it spicy');
    expect(noteToEnglish('crispy')).toBe('Make it crispy');
  });

  it('keeps a negation as the guest wrote it, because it is already an order', () => {
    expect(noteToEnglish('no onion')).toBe('No onion');
    expect(noteToEnglish('without garlic')).toBe('Without garlic');
  });

  it('drops courtesies and framing verbs, not the instruction', () => {
    expect(noteToEnglish('please extra spicy')).toBe('Make extra spicy');
    expect(noteToEnglish('make it extra spicy')).toBe('Make extra spicy');
  });

  it('leaves a note it does not understand exactly as written', () => {
    // The honest fallback: a mangled guess is worse than the guest's own
    // words -- "Jain" is a fact, not a verb to invent.
    expect(noteToEnglish('Jain')).toBe('Jain');
    expect(noteToEnglish('cut into small pieces')).toBe('Cut into small pieces');
  });
});
