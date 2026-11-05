import { describe, expect, it } from 'vitest';
import {
  hasFreshTranslation,
  isFresh,
  sourceHash,
  translatedDescription,
  translatedName,
  type TranslationMap,
} from './translations';

const hash = sourceHash('Paneer Tikka', 'Cottage cheese on skewers.');

const fresh: TranslationMap = {
  hi: {
    name: 'पनीर टिक्का',
    description: 'स्क्यूअर पर ग्रील्ड पनीर।',
    approved: true,
    sourceHash: hash,
  },
};

const unapproved: TranslationMap = {
  hi: { ...fresh.hi!, approved: false },
};

const outdated: TranslationMap = {
  hi: { ...fresh.hi!, sourceHash: 'deadbeef' },
};

describe('sourceHash', () => {
  it('is stable for the same source and changes when the source does', () => {
    expect(sourceHash('Paneer Tikka', 'Cottage cheese on skewers.')).toBe(hash);
    expect(sourceHash('Paneer Tikka', 'Grilled cottage cheese.')).not.toBe(hash);
    expect(sourceHash('Paneer Tikka Special', 'Cottage cheese on skewers.')).not.toBe(hash);
    expect(sourceHash('Dal', null)).toBe(sourceHash('Dal', ''));
  });
});

describe('the fallback rule', () => {
  it('shows the original when there is no translation', () => {
    expect(translatedName(undefined, 'hi', 'Paneer Tikka', 'desc')).toBe('Paneer Tikka');
    expect(translatedDescription({}, 'mr', 'Paneer Tikka', 'desc')).toBe('desc');
  });

  it('never shows a blank where the original has text', () => {
    const empty: TranslationMap = { hi: { name: '', description: '', approved: true, sourceHash: hash } };
    expect(translatedName(empty, 'hi', 'Paneer Tikka', 'Cottage cheese on skewers.')).toBe('Paneer Tikka');
  });

  it('shows the original for the original language, always', () => {
    expect(translatedName(fresh, 'en', 'Paneer Tikka', 'Cottage cheese on skewers.')).toBe('Paneer Tikka');
    expect(translatedDescription(fresh, 'en', 'Paneer Tikka', 'Cottage cheese on skewers.')).toBe(
      'Cottage cheese on skewers.'
    );
  });

  it('shows the translation when it is approved and matches the source', () => {
    expect(translatedName(fresh, 'hi', 'Paneer Tikka', 'Cottage cheese on skewers.')).toBe('पनीर टिक्का');
    expect(translatedDescription(fresh, 'hi', 'Paneer Tikka', 'Cottage cheese on skewers.')).toBe(
      'स्क्यूअर पर ग्रील्ड पनीर।'
    );
  });

  it('shows the original when the translation was never approved', () => {
    expect(translatedName(unapproved, 'hi', 'Paneer Tikka', 'Cottage cheese on skewers.')).toBe('Paneer Tikka');
  });

  it('shows the original when the dish has changed since — the outdated case', () => {
    expect(translatedName(outdated, 'hi', 'Paneer Tikka', 'NEW description')).toBe('Paneer Tikka');
    expect(translatedDescription(outdated, 'hi', 'Paneer Tikka', 'NEW description')).toBe('NEW description');
  });

  it('keeps hasFreshTranslation honest for the switcher decision', () => {
    expect(hasFreshTranslation(fresh, 'hi', 'Paneer Tikka', 'Cottage cheese on skewers.')).toBe(true);
    expect(hasFreshTranslation(fresh, 'mr', 'Paneer Tikka', 'Cottage cheese on skewers.')).toBe(false);
    expect(hasFreshTranslation(outdated, 'hi', 'Paneer Tikka', 'NEW description')).toBe(false);
    expect(isFresh(undefined, 'x', '')).toBe(false);
  });
});
