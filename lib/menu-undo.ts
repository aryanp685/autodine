/**
 * The row as it has to be put back, if the owner undoes a delete.
 *
 * It lives here rather than in the server actions because a 'use server'
 * module can only export async functions, and this needs to be testable: it is
 * the part standing between a query string and an INSERT.
 *
 * The payload travels in the URL rather than in a stash table because the
 * window is seconds long and the row is small. Nothing in it is trusted:
 * the restaurant id comes from the session, every field is checked here, and
 * the worst a tampered link can do is add a junk row to the owner's own menu.
 */
export type UndoItem = {
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
  isVeg: boolean;
  isAvailable: boolean;
  categoryId: string | null;
  sortOrder: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NAME = 120;
const MAX_DESCRIPTION = 500;

/**
 * Returns null for anything that is not a well-formed deleted row.
 *
 * A stale or hand-edited link is the common case rather than an exceptional
 * one -- the undo lives in a URL people can bookmark -- so every field is
 * validated and clamped instead of being assumed.
 */
export function readUndoItem(value: unknown): UndoItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  // A malformed id is rejected outright. It is the primary key, and inserting
  // with a value that is not a uuid would fail at the database with an error
  // the owner could not act on.
  const id = typeof v.id === 'string' && UUID_RE.test(v.id) ? v.id : null;
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, MAX_NAME) : '';
  if (!id || !name) return null;

  const price = Number(v.pricePaise);
  const sort = Number(v.sortOrder);
  const categoryId =
    typeof v.categoryId === 'string' && UUID_RE.test(v.categoryId) ? v.categoryId : null;

  return {
    id,
    name,
    description:
      typeof v.description === 'string' ? v.description.slice(0, MAX_DESCRIPTION) : null,
    // A negative price is nonsense and a float is a rounding bug waiting to
    // happen; money is stored in paise and stays an integer.
    pricePaise: Number.isFinite(price) && price >= 0 ? Math.round(price) : 0,
    isVeg: v.isVeg !== false,
    isAvailable: v.isAvailable !== false,
    categoryId,
    sortOrder: Number.isFinite(sort) ? Math.round(sort) : 0,
  };
}
