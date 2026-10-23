import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a failed order must not do.
 *
 * Reported from a phone: "could not place that order", with an empty cart
 * underneath it. The cart was never empty. The action redirected to a bare
 * `/menu/cart?error=…`, and the slug is what the cart is keyed by -- the
 * localStorage entry, the restaurant, the table session. So the guest landed on
 * a different cart: an empty one, next to a message saying their order had
 * failed. That reads as "my order vanished".
 *
 * Two things are pinned here:
 *
 *   1. the slug survives the redirect, whatever the failure was;
 *   2. a deployment failure (a migration that was never applied) does not tell
 *      the guest to "try again", because retrying that cannot work.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  parseCart: vi.fn(),
  loadTableAccess: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
}));

vi.mock('@/lib/cart-storage', () => ({ parseCart: mocks.parseCart }));

vi.mock('@/lib/table-access', () => ({ loadTableAccess: mocks.loadTableAccess }));

vi.mock('next/navigation', () => ({
  // Next's redirect() throws to unwind the render; a plain throw keeps the
  // control flow identical and lets the test read where it was sent.
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`redirect:${url}`);
  },
}));

const { placeOrderAction } = await import('../app/menu/checkout/actions');

function form(slug = 'kings-of-kings'): FormData {
  const data = new FormData();
  data.set('slug', slug);
  data.set('lines', JSON.stringify([{ itemId: 'i1', qty: 1 }]));
  return data;
}

async function run(action: () => Promise<void>): Promise<string> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('redirect:')) return message.slice('redirect:'.length);
    throw error;
  }
  throw new Error('the action returned instead of redirecting');
}

describe('placeOrderAction', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.parseCart.mockReset().mockReturnValue([{ itemId: 'i1', qty: 1 }]);
    mocks.redirect.mockReset();
    mocks.loadTableAccess.mockReset().mockResolvedValue({
      status: 'verified',
      slug: 'kings-of-kings',
      tableLabel: 'T2',
      session: { token: 'session-token' },
    });
  });

  it('keeps the restaurant in the URL when the database refuses the order', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Hara Bhara Kebab is sold out.' },
    });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.pathname).toBe('/menu/cart');
    expect(parsed.searchParams.get('s')).toBe('kings-of-kings');
    expect(parsed.searchParams.get('error')).toBe('Hara Bhara Kebab is sold out.');
  });

  it('keeps the restaurant in the URL when the failure is unexplained', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.searchParams.get('s')).toBe('kings-of-kings');
    expect(parsed.searchParams.get('error')).toBe(
      'We could not place that order. Please try again.'
    );
  });

  it('does not offer "try again" when the ordering function is not deployed', async () => {
    // PGRST202 is what Supabase answers when the RPC is not in the schema
    // cache: the migration that defines place_public_order has not been run
    // against this project. Retrying sends the guest round the same loop.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');
    const message = parsed.searchParams.get('error') ?? '';

    expect(parsed.searchParams.get('s')).toBe('kings-of-kings');
    expect(message).not.toMatch(/try again/i);
    expect(message).toMatch(/staff/i);
  });

  it('keeps the slug when the cart is empty', async () => {
    mocks.parseCart.mockReturnValue([]);

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.searchParams.get('s')).toBe('kings-of-kings');
    expect(parsed.searchParams.get('error')).toBe('Your cart is empty.');
  });

  it('sends a verified guest to their order, with the table session used', async () => {
    mocks.rpc.mockResolvedValue({ data: 'ORD-123', error: null });

    const url = await run(() => placeOrderAction(form()));

    expect(url).toMatch(/^\/menu\/order\?s=kings-of-kings&code=ORD-123&t=/);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'place_public_order',
      expect.objectContaining({ p_slug: 'kings-of-kings', p_session_token: 'session-token' })
    );
  });
});
