import { describe, expect, it } from 'vitest';
import { readUndoItem } from './menu-undo';

/**
 * This stands between a query string and an INSERT.
 *
 * The undo travels in a URL, which means it can be bookmarked, shared, sat on
 * for a week, or edited by hand. Every one of those is expected rather than
 * exceptional, so the validator treats the payload as hostile input and the
 * database never sees a value that came straight from it.
 */

const ID = '05979fc9-ad4d-482d-950f-27d3d0e1e519';
const CATEGORY = '937a3c2a-1331-43be-9d03-ecf6e9f84165';

const valid = {
  id: ID,
  name: 'Butter Chicken',
  description: 'Tandoori chicken, tomato, fenugreek',
  pricePaise: 46900,
  isVeg: false,
  isAvailable: true,
  categoryId: CATEGORY,
  sortOrder: 3,
};

describe('readUndoItem', () => {
  it('round-trips a row that was really deleted', () => {
    expect(readUndoItem(valid)).toEqual(valid);
  });

  it('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 42, true, []]) {
      expect(readUndoItem(bad)).toBeNull();
    }
  });

  it('rejects an id that is not a uuid, rather than letting the insert fail', () => {
    // The id is the primary key. A junk value would surface as a raw database
    // error the owner could not act on.
    expect(readUndoItem({ ...valid, id: 'not-a-uuid' })).toBeNull();
    expect(readUndoItem({ ...valid, id: 12345 })).toBeNull();
  });

  it('rejects a row with no name', () => {
    expect(readUndoItem({ ...valid, name: '' })).toBeNull();
    expect(readUndoItem({ ...valid, name: '   ' })).toBeNull();
    expect(readUndoItem({ ...valid, name: 42 })).toBeNull();
  });

  it('clamps an over-long name instead of throwing', () => {
    const out = readUndoItem({ ...valid, name: 'x'.repeat(500) });
    expect(out?.name).toHaveLength(120);
  });

  it('turns a negative price into zero', () => {
    // Money is stored in paise; a negative price is not a discount, it is a
    // broken row that would show up as a negative total on someone's bill.
    expect(readUndoItem({ ...valid, pricePaise: -500 })?.pricePaise).toBe(0);
  });

  it('keeps prices integral', () => {
    expect(readUndoItem({ ...valid, pricePaise: 46900.7 })?.pricePaise).toBe(46901);
    expect(readUndoItem({ ...valid, pricePaise: 'lots' })?.pricePaise).toBe(0);
  });

  it('drops a category id that is not a uuid, leaving the item uncategorised', () => {
    expect(readUndoItem({ ...valid, categoryId: 'nope' })?.categoryId).toBeNull();
    expect(readUndoItem({ ...valid, categoryId: null })?.categoryId).toBeNull();
  });

  it('defaults the food type and availability to true when missing', () => {
    const out = readUndoItem({ id: ID, name: 'Paneer', pricePaise: 100 });
    expect(out?.isVeg).toBe(true);
    expect(out?.isAvailable).toBe(true);
    expect(out?.description).toBeNull();
  });

  it('clamps an over-long description', () => {
    const out = readUndoItem({ ...valid, description: 'y'.repeat(2000) });
    expect(out?.description).toHaveLength(500);
  });
});
