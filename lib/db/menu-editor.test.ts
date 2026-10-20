import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers the editor's read path: which restaurant it resolves, and the
 * category counts the sidebar renders.
 *
 * The count is the part that can quietly lie. An item whose category_id is
 * NULL is invisible to diners -- items_public reaches an item only through its
 * category and that category's published menu -- so if the sidebar counted it
 * under some bucket, the editor would claim an item is filed when it is not.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import { getMenuEditorData } from './menu-editor';

type Row = Record<string, unknown>;

function fakeSupabase(rows: Record<string, Row | Row[]>) {
  const from = (table: string) => {
    const raw = rows[table] ?? [];
    // maybeSingle reads the first row; everything else returns the whole list.
    const data = Array.isArray(raw) ? raw : [raw];
    // Not annotated on purpose: see lib/db/kitchen-screen.test.ts.
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      gte: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
      then: (onFulfilled?: unknown, onRejected?: unknown) =>
        Promise.resolve({ data, error: null }).then(
          onFulfilled as () => unknown,
          onRejected as () => unknown
        ),
    };
    return chain;
  };
  return { from } as never;
}

function signedIn(supabase: unknown) {
  return {
    ok: true as const,
    context: {
      supabase,
      restaurantId: 'r-1',
      restaurantName: 'Kings of Kings',
      slug: 'kings-of-kings',
      timezone: 'Asia/Kolkata',
      tagline: null,
      role: 'owner',
    },
  };
}

const menu = { id: 'm-1', is_published: true };

const item = (id: string, categoryId: string | null = 'c-1') => ({
  id,
  category_id: categoryId,
  name: `Item ${id}`,
  description: null,
  price_paise: 10000,
  is_veg: true,
  is_available: true,
  sort_order: 0,
});

beforeEach(() => {
  mocks.staff.result = null;
});

describe('getMenuEditorData', () => {
  it('returns null when Supabase is unconfigured, so the screen uses demo rows', async () => {
    mocks.staff.result = { ok: false, reason: 'unconfigured' };
    expect(await getMenuEditorData()).toBeNull();
  });

  it('reports signed-out instead of handing a caller the sample menu', async () => {
    mocks.staff.result = { ok: false, reason: 'signed-out' };
    const data = await getMenuEditorData();
    expect(data?.blocked).toBe('signed-out');
    expect(data?.items).toEqual([]);
  });

  it('treats a restaurant with no menu row as empty rather than as demo mode', async () => {
    mocks.staff.result = signedIn(fakeSupabase({ menus: [] }));
    const data = await getMenuEditorData();

    expect(data?.blocked).toBeUndefined();
    expect(data?.menuId).toBe('');
    expect(data?.items).toEqual([]);
  });

  it('counts items per category, including unavailable ones the editor still lists', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        menus: menu,
        categories: [
          { id: 'c-1', name: 'Starters', sort_order: 0 },
          { id: 'c-2', name: 'Mains', sort_order: 1 },
        ],
        items: [
          item('i-1', 'c-1'),
          item('i-2', 'c-1'),
          { ...item('i-3', 'c-2'), is_available: false },
          item('i-4', 'c-2'),
          item('i-5', 'c-2'),
        ],
      })
    );

    const data = await getMenuEditorData();
    expect(data?.categories).toEqual([
      { id: 'c-1', name: 'Starters', itemCount: 2 },
      { id: 'c-2', name: 'Mains', itemCount: 3 },
    ]);
  });

  it('reports zero for a category holding nothing', async () => {
    mocks.staff.result = signedIn(
      fakeSupabase({
        menus: menu,
        categories: [{ id: 'c-1', name: 'Empty', sort_order: 0 }],
        items: [],
      })
    );

    expect((await getMenuEditorData())?.categories[0]).toEqual({
      id: 'c-1',
      name: 'Empty',
      itemCount: 0,
    });
  });

  it('does not count an uncategorised item under any category', async () => {
    // The whole point: an item with no category is invisible to diners, so it
    // must not be tallied as filed under anything.
    mocks.staff.result = signedIn(
      fakeSupabase({
        menus: menu,
        categories: [{ id: 'c-1', name: 'Starters', sort_order: 0 }],
        items: [item('i-1', null), item('i-2', 'c-1')],
      })
    );

    const data = await getMenuEditorData();
    expect(data?.categories[0].itemCount).toBe(1);
    expect(data?.items.filter((i) => !i.categoryId)).toHaveLength(1);
  });
});
