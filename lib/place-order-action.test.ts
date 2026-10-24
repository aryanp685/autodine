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

  it('tells the guest when the database found more than one match', async () => {
    // 21000 = cardinality_violation: a query returned two rows where the order
    // transaction needed one. Nothing was written, and repeating the same
    // ambiguous question gets the same refusal -- so: no retry, no "try again",
    // and a reference staff can search the logs for.
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '21000', message: 'more than one row' } });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(parsed.searchParams.get('s')).toBe('kings-of-kings');
    expect(parsed.searchParams.get('error')).toBe(
      'The kitchen’s system found more than one match for something in this order, so nothing was sent. Please order with staff, quoting the reference below.'
    );
    expect(parsed.searchParams.get('code')).toBe('21000');
  });

  it('treats an ambiguous singular response the same way', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'json' } });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(parsed.searchParams.get('error')).toMatch(/more than one match/i);
    expect(parsed.searchParams.get('code')).toBe('PGRST116');
  });

  it('carries the database sentence for a failure nobody has classified', async () => {
    // The guest still reads the written sentence, not this. The raw text rides
    // in the URL so one reproduction can be diagnosed from a screenshot.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '42804',
        message: 'more than one row returned by a subquery used as an expression',
        details: 'at statement 12',
        hint: null,
      },
    });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.searchParams.get('error')).toBe(
      'We could not place that order. Nothing was charged — please try again, or order with staff.'
    );
    expect(parsed.searchParams.get('d')).toBe(
      'more than one row returned by a subquery used as an expression · at statement 12'
    );
  });

  it('does not carry the database sentence for a failure it can name', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.searchParams.get('d')).toBeNull();
  });

  it('keeps the restaurant in the URL when the failure is unexplained', async () => {
    // A code nobody has classified yet: no retry, no claim about the cause.
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42804', message: 'boom' } });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.searchParams.get('s')).toBe('kings-of-kings');
    // The sentence says nothing was charged, and it does not promise a reason.
    expect(parsed.searchParams.get('error')).toBe(
      'We could not place that order. Nothing was charged — please try again, or order with staff.'
    );
    // The class of failure rides along so an unexplained break is diagnosable
    // instead of a sentence with nothing behind it.
    expect(parsed.searchParams.get('code')).toBe('42804');
  });

  it('tries once more when the database was merely unreachable', async () => {
    // PGRST002/003 and friends abort before the order is written, so a second
    // call cannot make two orders. The first call fails, the second lands.
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST003', message: 'pool timeout' } })
      .mockResolvedValueOnce({ data: 'KI-ABC12', error: null });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(parsed.pathname).toBe('/menu/order');
    expect(parsed.searchParams.get('code')).toBe('KI-ABC12');
  });

  it('lands on the second retry when the schema cache was still reloading', async () => {
    // A free-tier database answers PGRST002 for a second or two after a restart.
    // One 400 ms wait is inside that window; the second wait is what makes the
    // difference between a placed order and a guest told to tap the button.
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST002', message: 'loading' } })
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST002', message: 'loading' } })
      .mockResolvedValueOnce({ data: 'KI-ZZZ99', error: null });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(parsed.pathname).toBe('/menu/order');
    expect(parsed.searchParams.get('code')).toBe('KI-ZZZ99');
  });

  it('says the system was busy when even the retries could not reach it', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST003', message: 'pool timeout' },
    });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(parsed.searchParams.get('error')).toMatch(/system was busy for a moment/i);
    expect(parsed.searchParams.get('code')).toBe('PGRST003');
  });

  it('does not retry a refusal the guest has to act on', async () => {
    // A sold-out dish will be sold out on the second call too; retrying only
    // makes the guest wait longer for the same sentence.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Hara Bhara Kebab is sold out.' },
    });

    await run(() => placeOrderAction(form()));

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('tells a guest their cart is stale rather than to tap again', async () => {
    // 22P02 is invalid_text_representation: an id in the cart is not a uuid,
    // which is what a cart left over from an older menu sends.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid' },
    });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.searchParams.get('error')).toMatch(/no longer on this menu/i);
    expect(parsed.searchParams.get('error')).not.toMatch(/invalid input syntax/i);
  });

  it('does not tell a guest to order twice when a double tap duplicated it', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });

    const url = await run(() => placeOrderAction(form()));
    expect(new URL(url, 'https://example.test').searchParams.get('error')).toMatch(
      /already went through/i
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
