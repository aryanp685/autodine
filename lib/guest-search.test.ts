import { describe, expect, it } from 'vitest';
import { filterDishes, normalise } from './guest-search';

/**
 * Search is the one feature on the menu that can be confidently wrong: a filter
 * that silently drops a dish is indistinguishable from a menu that does not
 * have it, and nobody reports that as a bug -- they just order something else.
 */

const DISHES = [
  { name: 'Paneer Tikka', desc: 'Charred paneer, mint chutney', category: 'starters' },
  { name: 'Butter Chicken', desc: 'Tomato, cream, fenugreek', category: 'mains' },
  { name: 'Garlic Naan', desc: 'Tandoor bread', category: 'breads' },
  { name: 'Kulfi', desc: 'Pistachio, cardamom', category: 'desserts' },
];

const CATEGORIES = {
  starters: 'Starters',
  mains: 'Main course',
  breads: 'Breads',
  desserts: 'Desserts',
};

describe('normalise', () => {
  it('folds case, accents and stray spacing', () => {
    expect(normalise('  Crème   Brûlée ')).toBe('creme brulee');
  });
});

describe('filterDishes', () => {
  it('returns everything for an empty query', () => {
    expect(filterDishes(DISHES, '')).toHaveLength(DISHES.length);
    expect(filterDishes(DISHES, '   ')).toHaveLength(DISHES.length);
  });

  it('matches the name, case-insensitively', () => {
    const found = filterDishes(DISHES, 'PANEER', CATEGORIES);
    expect(found.map((d) => d.name)).toEqual(['Paneer Tikka']);
  });

  it('matches the description when the name says nothing', () => {
    const found = filterDishes(DISHES, 'cardamom', CATEGORIES);
    expect(found.map((d) => d.name)).toEqual(['Kulfi']);
  });

  it('matches the course, so "dessert" finds the kulfi', () => {
    const found = filterDishes(DISHES, 'dessert', CATEGORIES);
    expect(found.map((d) => d.name)).toEqual(['Kulfi']);
  });

  /**
   * Every word narrows. A search that ORs its terms returns the whole menu for
   * "paneer tikka" the moment one word matches anything, which reads as broken.
   */
  it('requires every word to match somewhere', () => {
    expect(filterDishes(DISHES, 'paneer chutney', CATEGORIES).map((d) => d.name)).toEqual([
      'Paneer Tikka',
    ]);
    expect(filterDishes(DISHES, 'paneer kulfi', CATEGORIES)).toEqual([]);
  });

  it('finds nothing for a dish that is not there, without throwing', () => {
    expect(filterDishes(DISHES, 'sushi', CATEGORIES)).toEqual([]);
    expect(filterDishes([], 'paneer', CATEGORIES)).toEqual([]);
  });

  it('keeps the menu order rather than the match order', () => {
    const found = filterDishes(DISHES, 'a', CATEGORIES);
    const names = found.map((d) => d.name);
    expect(names).toEqual(DISHES.map((d) => d.name).filter((n) => names.includes(n)));
  });

  it('does not mutate the list it is given', () => {
    const copy = [...DISHES];
    filterDishes(DISHES, 'naan', CATEGORIES);
    expect(DISHES).toEqual(copy);
  });
});
