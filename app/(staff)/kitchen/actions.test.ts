import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one write the kitchen board makes.
 *
 * These are not UI tests: they are the four facts the screen depends on and
 * cannot check for itself.
 *
 *   1. The next state is derived from the row in the DATABASE, never from the
 *      request. A browser that could post `served` could skip a ticket past
 *      the kitchen without a single error being raised.
 *   2. A role that may watch the board may not move it, and the refusal comes
 *      from this function rather than from a hidden button.
 *   3. The update is a compare-and-set on the state that was read, so two
 *      screens cannot walk a ticket backwards.
 *   4. An update that changes zero rows is a failure the board can see.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
  /** Every chain built by the fake client, in call order. */
  queries: [] as {
    table: string;
    kind: 'select' | 'update';
    select?: string;
    update?: Record<string, unknown>;
    filters: [string, unknown][];
    /** What `.select()` returns for an update. */
    updated?: { id: string; prep_status: string }[] | null;
    error?: { message: string; code?: string } | null;
  }[],
  revalidate: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => mocks.revalidate(path) }));

vi.mock('@/lib/db/staff', () => ({
  getStaffContext: () => Promise.resolve(mocks.staff.result),
  KITCHEN_ROLES: ['owner', 'manager', 'kitchen'],
}));

import { advanceOrderAction } from './actions';

/**
 * A supabase-shaped fake.
 *
 * `read` is what `.maybeSingle()` answers; `write` is what the update's
 * `.select()` answers. Everything in between is recorded so a test can assert
 * the predicate, not just the outcome.
 */
function client(options: {
  read?: { data: unknown; error?: unknown };
  write?: { data: unknown; error?: unknown };
}) {
  const record = {
    table: '',
    kind: 'select' as 'select' | 'update',
    filters: [] as [string, unknown][],
    select: undefined as string | undefined,
    update: undefined as Record<string, unknown> | undefined,
  };

  const chain: Record<string, unknown> = {};
  chain.select = (columns?: string) => {
    record.select = columns;
    return chain;
  };
  chain.update = (values: Record<string, unknown>) => {
    record.kind = 'update';
    record.update = values;
    return chain;
  };
  chain.eq = (column: string, value: unknown) => {
    record.filters.push([column, value]);
    return chain;
  };
  chain.maybeSingle = () => {
    mocks.queries.push({ ...record });
    return Promise.resolve({ data: options.read?.data ?? null, error: options.read?.error ?? null });
  };
  chain.then = (resolve: (value: unknown) => unknown) => {
    mocks.queries.push({ ...record });
    return Promise.resolve({
      data: options.write?.data ?? null,
      error: options.write?.error ?? null,
    }).then(resolve);
  };

  return {
    from: (table: string) => {
      record.table = table;
      record.kind = 'select';
      record.filters = [];
      record.select = undefined;
      record.update = undefined;
      if (options.write) {
        // An update's final `.select()` is awaited directly, so the chain has
        // to be thenable rather than answering here.
        chain.select = (columns?: string) => {
          record.select = columns;
          return chain;
        };
      }
      return chain;
    },
  };
}

function asRole(role: string, clientOptions: Parameters<typeof client>[0]) {
  mocks.staff.result = { supabase: client(clientOptions), restaurantId: 'r-1', role };
}

beforeEach(() => {
  mocks.queries.length = 0;
  mocks.revalidate.mockReset();
});

describe('who may move a ticket', () => {
  it('refuses a waiter before it reads anything', async () => {
    asRole('waiter', { read: { data: { id: 'o-1', prep_status: 'new' } } });

    const result = await advanceOrderAction('o-1');

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/waiter/);
    // Not merely refused: no query was made at all.
    expect(mocks.queries).toHaveLength(0);
  });

  it('refuses a signed-out or unconnected caller without a database error', async () => {
    mocks.staff.result = null;
    const result = await advanceOrderAction('o-1');
    expect(result.ok).toBe(false);
    expect(mocks.queries).toHaveLength(0);
  });

  it('lets the three kitchen roles through', async () => {
    for (const role of ['owner', 'manager', 'kitchen']) {
      mocks.queries.length = 0;
      asRole(role, {
        read: { data: { id: 'o-1', prep_status: 'new' } },
        write: { data: [{ id: 'o-1', prep_status: 'preparing' }] },
      });
      const result = await advanceOrderAction('o-1');
      expect(result, role).toEqual({ ok: true, state: 'preparing' });
    }
  });
});

describe('the next state', () => {
  it('comes from the row, not from the caller', async () => {
    asRole('kitchen', {
      read: { data: { id: 'o-1', prep_status: 'new' } },
      write: { data: [{ id: 'o-1', prep_status: 'preparing' }] },
    });

    await advanceOrderAction('o-1');

    const update = mocks.queries.find((query) => query.kind === 'update');
    // One stage, never a jump: 'served' is three taps away and there is no
    // request shape that reaches it in one.
    expect(update?.update).toEqual({ prep_status: 'preparing' });
  });

  it('refuses to skip a stage even when it is asked to', async () => {
    asRole('kitchen', {
      read: { data: { id: 'o-1', prep_status: 'preparing' } },
      write: { data: [{ id: 'o-1', prep_status: 'ready' }] },
    });

    // The action takes an id and nothing else -- there is no parameter to
    // abuse. This asserts the signature by asserting the effect.
    await advanceOrderAction('o-1');
    expect(mocks.queries.find((q) => q.kind === 'update')?.update).toEqual({ prep_status: 'ready' });
  });

  it('treats an already-served ticket as settled instead of writing', async () => {
    asRole('kitchen', { read: { data: { id: 'o-1', prep_status: 'served' } } });

    const result = await advanceOrderAction('o-1');

    expect(result).toEqual({ ok: true, state: 'served' });
    expect(mocks.queries.some((query) => query.kind === 'update')).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe('two screens at once', () => {
  it('writes only over the state it read', async () => {
    asRole('kitchen', {
      read: { data: { id: 'o-1', prep_status: 'preparing' } },
      write: { data: [{ id: 'o-1', prep_status: 'ready' }] },
    });

    await advanceOrderAction('o-1');

    const update = mocks.queries.find((query) => query.kind === 'update');
    // id, restaurant, AND the prep state that was read. Without the last one a
    // slow writer can put a ticket back to 'preparing' after another screen
    // already moved it to 'ready'.
    expect(update?.filters).toEqual([
      ['id', 'o-1'],
      ['restaurant_id', 'r-1'],
      ['prep_status', 'preparing'],
    ]);
  });

  it('reports the loss when the row moved on, rather than claiming success', async () => {
    asRole('kitchen', {
      read: { data: { id: 'o-1', prep_status: 'preparing' } },
      write: { data: [] },
    });

    const result = await advanceOrderAction('o-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/another screen/i);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe('a ticket that is not this restaurant’s', () => {
  it('answers the same way as a ticket that does not exist', async () => {
    asRole('kitchen', { read: { data: null } });

    const result = await advanceOrderAction('3f1c9f52-8f0e-4a5f-9a6b-2c1d4e5f6a7b');

    expect(result).toEqual({ ok: false, error: 'That ticket is no longer on the board.' });
    expect(mocks.queries.some((query) => query.kind === 'update')).toBe(false);
  });

  it('binds the restaurant into the read as well as the write', async () => {
    asRole('kitchen', { read: { data: null } });
    await advanceOrderAction('o-1');
    expect(mocks.queries[0].filters).toEqual([
      ['id', 'o-1'],
      ['restaurant_id', 'r-1'],
    ]);
  });
});

describe('when the database says no', () => {
  it('turns a read-only restaurant into a sentence, not a Postgres code', async () => {
    asRole('kitchen', {
      read: { data: { id: 'o-1', prep_status: 'new' } },
      write: { data: null, error: { message: 'permission denied for table orders', code: '42501' } },
    });

    const result = await advanceOrderAction('o-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/read-only/i);
      expect(result.error).not.toContain('42501');
    }
  });

  it('passes any other failure through as a failure, not a success', async () => {
    asRole('kitchen', {
      read: { data: { id: 'o-1', prep_status: 'new' } },
      write: { data: null, error: { message: 'connection reset' } },
    });

    const result = await advanceOrderAction('o-1');
    expect(result.ok).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
