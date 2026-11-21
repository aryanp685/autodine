import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
  rpc: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
  tableCodes: [] as Array<{ id: string }>,
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => mocks.revalidate(path) }));
vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import { setTableActiveAction } from './actions';

const TABLE_ID = '11111111-1111-1111-1111-111111111111';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function redirectedUrl(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('redirect:')) return message.slice('redirect:'.length);
    throw error;
  }
  throw new Error('the action returned instead of redirecting');
}

beforeEach(() => {
  mocks.staff.result = {
    ok: true,
    context: {
      role: 'owner',
      restaurantId: 'restaurant-1',
      supabase: { rpc: mocks.rpc, from: mocks.from },
    },
  };
  mocks.tableCodes = [{ id: 'qr-1' }];
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.update.mockReset().mockResolvedValue({ error: null });
  mocks.from.mockReset().mockImplementation((table: string) => {
    if (table === 'table_qr_codes') {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        limit: async () => ({ data: mocks.tableCodes, error: null }),
      };
      return query;
    }
    if (table === 'dining_tables') {
      const query = {
        update: (values: { is_active: boolean }) => {
          mocks.update(values);
          return query;
        },
        eq: () => query,
        then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
      };
      return query;
    }
    throw new Error(`unexpected table ${table}`);
  });
  mocks.redirect.mockReset();
  mocks.revalidate.mockReset();
});

describe('setTableActiveAction', () => {
  it('enables a table and issues a live code first when none exists', async () => {
    mocks.tableCodes = [];

    const url = await redirectedUrl(() => setTableActiveAction(form({ tableId: TABLE_ID, active: 'true' })));

    expect(mocks.rpc).toHaveBeenCalledWith('rotate_table_qr_code', { p_table_id: TABLE_ID });
    expect(mocks.update).toHaveBeenCalledWith({ is_active: true });
    expect(new URL(url, 'https://example.test').searchParams.get('notice')).toMatch(/enabled with a new QR code/i);
  });

  it('disables a table when the hidden form state is false', async () => {
    const url = await redirectedUrl(() => setTableActiveAction(form({ tableId: TABLE_ID, active: 'false' })));

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ is_active: false });
    expect(new URL(url, 'https://example.test').searchParams.get('notice')).toMatch(/table disabled/i);
  });

  it.each([undefined, '', 'yes'])('refuses a missing or malformed active state (%s)', async (active) => {
    const fields = { tableId: TABLE_ID, ...(active === undefined ? {} : { active }) };
    const url = await redirectedUrl(() => setTableActiveAction(form(fields)));

    expect(new URL(url, 'https://example.test').searchParams.get('error')).toMatch(/missing or invalid/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
