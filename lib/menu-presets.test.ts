import { describe, expect, it } from 'vitest';
import { PRESET_CATEGORIES, normaliseCategoryName } from './menu-presets';

/**
 * The fold is what keeps a chip from appearing twice.
 *
 * It runs against names already in the database, and those are whatever the
 * owner typed. A category saved as "starters" is the same thing as the preset
 * "Starters" -- if the fold missed that, the owner would see the preset as
 * still-offered and could add a second, near-identical category next to the
 * one they already have.
 */
describe('normaliseCategoryName', () => {
  it('folds case so a lower-cased save matches the preset', () => {
    // This is the actual case from the live database: the category was typed
    // in lower case and would otherwise have sat beside a duplicate chip.
    expect(normaliseCategoryName('starters')).toBe(normaliseCategoryName('Starters'));
  });

  it('trims and collapses inner whitespace', () => {
    expect(normaliseCategoryName('  Main   Course  ')).toBe('main course');
  });

  it('reads an empty or whitespace-only name as empty', () => {
    expect(normaliseCategoryName('   ')).toBe('');
  });
});

describe('PRESET_CATEGORIES', () => {
  it('covers the categories an Indian restaurant menu is built from', () => {
    expect(PRESET_CATEGORIES).toEqual([
      'Starters',
      'Main Course',
      'Breads',
      'Rice & Biryani',
      'Beverages',
      'Desserts',
    ]);
  });

  it('has no names that fold to the same thing', () => {
    // Two presets matching each other would mean the chip list could never
    // show both states correctly -- the second would always look present.
    const folded = PRESET_CATEGORIES.map(normaliseCategoryName);
    expect(new Set(folded).size).toBe(folded.length);
  });

  it('has no empty names', () => {
    expect(PRESET_CATEGORIES.every((n) => normaliseCategoryName(n) !== '')).toBe(true);
  });
});
