import { describe, expect, it } from 'vitest';
import { movedOrder, renumber } from './reorder';

const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('movedOrder', () => {
  it('moves a row one place up', () => {
    expect(movedOrder(rows, 'c', 'up')?.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('moves a row one place down', () => {
    expect(movedOrder(rows, 'a', 'down')?.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('refuses a move past either edge', () => {
    expect(movedOrder(rows, 'a', 'up')).toBeNull();
    expect(movedOrder(rows, 'c', 'down')).toBeNull();
  });

  it('refuses an id that is not in the group', () => {
    expect(movedOrder(rows, 'zzz', 'up')).toBeNull();
    expect(movedOrder(rows, 'zzz', 'down')).toBeNull();
  });

  it('returns a copy and leaves the input untouched', () => {
    const moved = movedOrder(rows, 'a', 'down');
    expect(moved).not.toBe(rows);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a one-row group unchanged and impossible to move', () => {
    expect(movedOrder([{ id: 'only' }], 'only', 'up')).toBeNull();
    expect(movedOrder([{ id: 'only' }], 'only', 'down')).toBeNull();
  });
});

describe('renumber', () => {
  it('writes only the rows whose value changes', () => {
    const moved = [
      { id: 'b', order: 0 },
      { id: 'a', order: 0 },
      { id: 'c', order: 2 },
    ];
    // b already sits at 0 and c at 2: only 'a' actually needs a write.
    expect(renumber(moved, (row) => row.order)).toEqual([{ id: 'a', sortOrder: 1 }]);
  });

  it('fills in sequential values from any starting mess', () => {
    const messy = [
      { id: 'x', order: 5 },
      { id: 'y', order: 7 },
      { id: 'z', order: 9 },
    ];
    expect(renumber(messy, (row) => row.order)).toEqual([
      { id: 'x', sortOrder: 0 },
      { id: 'y', sortOrder: 1 },
      { id: 'z', sortOrder: 2 },
    ]);
  });
});
