/**
 * Moving a row one place in its ordered group.
 *
 * A pure function rather than SQL so the move can be tested as arithmetic:
 * the server actions renumber the whole group after every move, which keeps
 * the order stable even when rows share a sort_order of 0 (every hand-added
 * item starts there).
 */

export type OrderedRow = { id: string };

/**
 * Return the group with `id` moved one place up or down, or null when the
 * move is not possible: unknown id, or already at that edge.
 */
export function movedOrder<T extends OrderedRow>(
  rows: readonly T[],
  id: string,
  direction: 'up' | 'down'
): T[] | null {
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return null;
  const next = [...rows];
  next[index] = rows[target];
  next[target] = rows[index];
  return next;
}

/**
 * Renumber a group 0..n-1 in its new order. Only the rows whose value
 * changes are returned, so the caller writes the minimum.
 */
export function renumber<T extends OrderedRow>(
  rows: readonly T[],
  currentOrder: (row: T) => number
): { id: string; sortOrder: number }[] {
  const changed: { id: string; sortOrder: number }[] = [];
  rows.forEach((row, index) => {
    if (currentOrder(row) !== index) changed.push({ id: row.id, sortOrder: index });
  });
  return changed;
}
