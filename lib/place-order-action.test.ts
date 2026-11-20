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
  /** The throttle flag the scan handler left behind, if any. */
  throttle: null as string | null,
}));

/* Only one cookie is ever read on this path, and it is a note, not a key. */
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'autodine_throttled' && mocks.throttle ? { name, value: mocks.throttle } : undefined,
  }),
  // ipHash() reads the forwarded address through headers(); the action now
  // passes a per-restaurant ip hash to place_public_order's rate budget.
  headers: async () => new Map([['x-forwarded-for', '203.0.113.9']]),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc: async (...args: unknown[]) => { const result = await mocks.rpc(...args); return result && typeof result.data === 'string' ? { ...result, data: { code: result.data, error: null } } : result; } }),
}));

vi.mock('@/lib/cart-storage', () => ({ parseCart: mocks.parseCart }));

vi.mock('@/lib/table-access', () => ({
  loadTableAccess: mocks.loadTableAccess,
  codePageHref: (token: string) => `/t/${encodeURIComponent(token)}/code`,
}));

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
  data.set('table', 'verified-table');
  data.set('attempt', '9f4b6c1e-2d3a-4b5c-8d7e-0a1b2c3d4e5f');
  data.set('lines', JSON.stringify([{ itemId: 'i1', qty: 1 }]));
  return data;
}

async function run(action: () => ReturnType<typeof placeOrderAction>): Promise<string> {
  const result = await action();
  if (result.kind === 'unconfirmed') throw new Error('Expected a navigable result');
  return result.href;
}

describe('placeOrderAction', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.parseCart.mockReset().mockReturnValue([{ itemId: 'i1', qty: 1 }]);
    mocks.redirect.mockReset();
    mocks.throttle = null;
    mocks.loadTableAccess.mockReset().mockResolvedValue({
      status: 'verified',
      slug: 'kings-of-kings',
      tableLabel: 'T2',
      tableId: 'verified-table',
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
    expect(parsed.searchParams.get('error')).toMatch(/could not confirm/);
    expect(url).not.toContain('Hara');
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
      'The kitchen’s system refused this order while writing it, so nothing was sent. Please order with staff, quoting the reference below.'
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

  it('gives only a private lookup URL, without a cart-clearing flag', async () => {
    mocks.rpc.mockResolvedValue({ data: 'KI-FRESH1', error: null });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.pathname).toBe('/menu/order');
    expect(parsed.searchParams.has('placed')).toBe(false);
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

  it('keeps the same attempt when even the retries cannot verify it', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST003', message: 'pool timeout' },
    });

    expect(await placeOrderAction(form())).toEqual({ kind: 'unconfirmed' });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(new Set(mocks.rpc.mock.calls.map(([, args]) => args.p_guest_token)).size).toBe(1);
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

    expect(await placeOrderAction(form())).toEqual({ kind: 'unconfirmed' });
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

  it('sends a guest who scanned a card but has not entered the code to the code form, not a dead end', async () => {
    // The browsing state: the menu and the cart are open, and the order has to
    // ask for the on-site code. This is the ordinary path now, not an error.
    mocks.loadTableAccess.mockResolvedValue({
      status: 'browse',
      qrToken: 'qr_abcdefghijklmnop',
      slug: 'kings-of-kings',
      tableLabel: 'T2',
      windowSeconds: 600,
    });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.pathname).toBe('/t/qr_abcdefghijklmnop/code');
    // …and back to the checkout afterwards, so the cart is one tap away.
    expect(parsed.searchParams.get('next')).toBe('/menu/checkout?s=kings-of-kings');
    // Nothing was written.
    expect(mocks.rpc).not.toHaveBeenCalled();
  });


  it('does not send a throttled guest to a code form that cannot help them', async () => {
    /*
     * The bug this replaces: a guest whose scan was throttled has no session,
     * so they arrive here as `browse` -- and in a restaurant that has switched
     * the rotating code off, the code form has nothing to ask for. They were
     * sent to it anyway, typed nothing, and came back to the same refusal.
     *
     * Nothing is loosened by this branch: the order is still refused, and the
     * sentence says so first.
     */
    mocks.throttle = 'throttled';
    mocks.loadTableAccess.mockResolvedValue({
      status: 'browse',
      qrToken: 'qr_abcdefghijklmnop',
      slug: 'kings-of-kings',
      tableLabel: 'T2',
      windowSeconds: 600,
    });

    const url = await run(() => placeOrderAction(form()));
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.pathname).toBe('/menu/cart');
    expect(parsed.searchParams.get('s')).toBe('kings-of-kings');
    const message = parsed.searchParams.get('error') ?? '';
    expect(message).toContain('Your order was not sent');
    expect(message).toContain('cart is safe');
    expect(message).toContain('order with our staff');
    // Never the code sentence: there is no code in this restaurant.
    expect(message.toLowerCase()).not.toContain('enter the code');

    // And nothing was written, which is the claim the sentence makes.
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('still asks a normal scanning guest for the code', async () => {
    // The throttle branch must not swallow the ordinary path.
    mocks.throttle = null;
    mocks.loadTableAccess.mockResolvedValue({
      status: 'browse',
      qrToken: 'qr_abcdefghijklmnop',
      slug: 'kings-of-kings',
      tableLabel: 'T2',
      windowSeconds: 600,
    });

    const url = await run(() => placeOrderAction(form()));
    expect(new URL(url, 'https://example.test').pathname).toBe('/t/qr_abcdefghijklmnop/code');
  });

  it('will not write an order for a guest the database did not verify', async () => {
    mocks.loadTableAccess.mockResolvedValue({ status: 'none' });

    const url = await run(() => placeOrderAction(form()));

    const parsed = new URL(url, 'https://example.test');
    expect(parsed.pathname).toBe('/menu/cart');
    expect(parsed.searchParams.get('error')).toContain('Scan the QR code');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends one attempt key, so a re-post cannot write a second order', async () => {
    mocks.rpc.mockResolvedValue({ data: 'ORD-9', error: null });

    const attempt = '01234567-89ab-4cde-8f01-23456789abcd';
    const data = form();
    data.set('attempt', attempt);

    const url = await run(() => placeOrderAction(data));

    expect(mocks.rpc).toHaveBeenCalledWith(
      'place_public_order_attempt',
      expect.objectContaining({ p_guest_token: attempt })
    );
    // The same key is what the confirmation link carries.
    expect(url).toContain(`t=${attempt}`);
  });

  it('does not mint a new attempt key when the supplied one is invalid', async () => {
    const data = form();
    data.set('attempt', 'invalid-attempt');
    expect(await placeOrderAction(data)).toMatchObject({ kind: 'refused', keepAttempt: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a checkout kept open at the previously scanned table', async () => {
    const data = form();
    data.set('table', 'previous-table');
    expect(await placeOrderAction(data)).toMatchObject({ kind: 'refused', keepAttempt: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('retains an attempt on transport loss and logs only a controlled reference', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.rpc.mockResolvedValue({ data: null, error: {code: '', message: 'private body marker', details: 'private session marker'} });
      expect(await placeOrderAction(form())).toEqual({ kind: 'unconfirmed' });
      expect(log).toHaveBeenCalledWith('[placeOrderAction] result unavailable or refused', 'unclassified');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally { log.mockRestore(); }
  });

  it('sends a verified guest to their order, with the table session used', async () => {
    mocks.rpc.mockResolvedValue({ data: 'ORD-123', error: null });

    const url = await run(() => placeOrderAction(form()));

    expect(url).toMatch(/^\/menu\/order\?s=kings-of-kings&code=ORD-123&t=/);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'place_public_order_attempt',
      expect.objectContaining({ p_slug: 'kings-of-kings', p_session_token: 'session-token' })
    );
  });
});
