import { describe, expect, it, vi } from 'vitest';
import { isOrderToken, readGuestOrderStatus, type StatusClient } from './order-status';

/**
 * The one read the guest's live status is allowed to make.
 *
 * Access isolation is the point of this file: an order is readable only by the
 * exact slug + code + token triple the database function requires. Everything
 * else is refused before a query is made, so a stale or mangled link cannot
 * turn into a 500 -- and, more importantly, a guessed token cannot turn into a
 * row.
 */

const TOKEN = '3f1c9f52-8f0e-4a5f-9a6b-2c1d4e5f6a7b';

function client(result: { data: unknown; error: unknown }): StatusClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn().mockResolvedValue(result) } as never;
}

const row = {
  prep_status: 'preparing',
  payment_status: 'pending',
  placed_at: '2026-10-26T10:00:00.000Z',
  hold_required: false,
  confirmed_at: null,
};

describe('the guest token', () => {
  it('accepts a uuid, which is what the column holds', () => {
    expect(isOrderToken(TOKEN)).toBe(true);
    expect(isOrderToken(` ${TOKEN} `)).toBe(true);
  });

  it('refuses anything else before it reaches Postgres', () => {
    // Postgres raises 22P02 on a non-uuid argument, which the browser would see
    // as a 500 from a page that is working exactly as designed.
    for (const bad of ['', 'KI-ABC12', 'abc', null, undefined, '1234-5678']) {
      expect(isOrderToken(bad as string), String(bad)).toBe(false);
    }
  });
});

describe('reading a status', () => {
  it('asks for exactly one order, by slug, code and token', async () => {
    const supabase = client({ data: row, error: null });
    const result = await readGuestOrderStatus(
      { slug: 'kings-of-kings', code: 'KI-ABC12', token: TOKEN },
      supabase,
    );

    expect(supabase.rpc).toHaveBeenCalledWith('get_public_order', {
      p_slug: 'kings-of-kings',
      p_code: 'KI-ABC12',
      p_token: TOKEN,
    });
    expect(result).toMatchObject({ kind: 'ok', snapshot: { status: 'preparing' } });
  });

  it('reports a held order as waiting, not as in the kitchen', async () => {
    const supabase = client({
      data: { ...row, prep_status: 'new', hold_required: true, confirmed_at: null },
      error: null,
    });

    const result = await readGuestOrderStatus({ slug: 's', code: 'c', token: TOKEN }, supabase);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.snapshot.awaitingConfirmation).toBe(true);
  });

  it('stops saying a held order is waiting once a person confirms it', async () => {
    const supabase = client({
      data: { ...row, prep_status: 'new', hold_required: true, confirmed_at: '2026-10-26T10:02:00.000Z' },
      error: null,
    });

    const result = await readGuestOrderStatus({ slug: 's', code: 'c', token: TOKEN }, supabase);
    if (result.kind === 'ok') expect(result.snapshot.awaitingConfirmation).toBe(false);
  });

  it('stamps the answer with the server clock, not the caller’s', async () => {
    const supabase = client({ data: row, error: null });
    const before = Date.now();
    const result = await readGuestOrderStatus({ slug: 's', code: 'c', token: TOKEN }, supabase);

    if (result.kind !== 'ok') throw new Error('expected an answer');
    const stamped = Date.parse(result.snapshot.checkedAt);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('what a bad credential gets', () => {
  it('says not found when the triple does not match, without leaking why', async () => {
    // get_public_order returns no row for a wrong token. It cannot distinguish
    // "wrong token" from "no such order", which is the point.
    const supabase = client({ data: null, error: null });
    const result = await readGuestOrderStatus({ slug: 's', code: 'c', token: TOKEN }, supabase);
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('does not ask the database at all for an incomplete link', async () => {
    const supabase = client({ data: row, error: null });

    for (const input of [
      { slug: '', code: 'KI-ABC12', token: TOKEN },
      { slug: 's', code: '', token: TOKEN },
      { slug: 's', code: 'KI-ABC12', token: 'guess' },
      { slug: null, code: null, token: null },
    ]) {
      const result = await readGuestOrderStatus(input, supabase);
      expect(result).toEqual({ kind: 'not_found' });
    }

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('separates a database failure from a missing order', async () => {
    const supabase = client({ data: null, error: { message: 'connection reset' } });
    const result = await readGuestOrderStatus({ slug: 's', code: 'c', token: TOKEN }, supabase);
    // Retryable, unlike not_found: the order probably exists.
    expect(result.kind).toBe('unavailable');
  });

  it('refuses to invent a status for a row without one', async () => {
    const supabase = client({ data: { ...row, prep_status: null }, error: null });
    const result = await readGuestOrderStatus({ slug: 's', code: 'c', token: TOKEN }, supabase);
    expect(result.kind).toBe('unavailable');
  });
});
