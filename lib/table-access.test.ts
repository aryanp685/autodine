import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTableAccess, verifyAgainHref } from './table-access';

/**
 * The gate every guest page reads.
 *
 * The point of these tests is that nothing here trusts the cookie. The cookie
 * arrives from a browser the customer controls, so every interesting case is
 * one where the cookie says one thing and the database says another -- and the
 * database has to win.
 */

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  cardCookie: undefined as string | undefined,
  rpc: null as null | ((name: string, args: unknown) => Promise<unknown>),
  calls: [] as { name: string; args: unknown }[],
  cookieWrites: [] as { name: string; value: string }[],
}));

vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: true }));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: (name: string, args: unknown) => {
      state.calls.push({ name, args });
      return state.rpc!(name, args);
    },
  }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === 'autodine_table' && state.cookie !== undefined) {
        return { name, value: state.cookie };
      }
      if (name === 'autodine_table_card' && state.cardCookie !== undefined) {
        return { name, value: state.cardCookie };
      }
      return undefined;
    },
    set: (name: string, value: string) => state.cookieWrites.push({ name, value }),
    delete: () => {
      state.cookie = undefined;
    },
  }),
}));

afterEach(() => {
  state.cookie = undefined;
  state.cardCookie = undefined;
  state.rpc = null;
  state.calls = [];
  state.cookieWrites = [];
});

const TOKEN = 'b'.repeat(64);
const QR_TOKEN = 'qr_abcdefghijklmnop';
const EXPIRES = new Date(Date.now() + 30 * 60_000).toISOString();

function cookie(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    token: TOKEN,
    slug: 'maddi',
    tableLabel: 'T1',
    expiresAt: EXPIRES,
    qrToken: QR_TOKEN,
    ...overrides,
  });
}

/** A database answer: one live session row. */
function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    data: [
      {
        restaurant_id: '11111111-1111-1111-1111-111111111111',
        restaurant_slug: 'maddi',
        table_id: '22222222-2222-2222-2222-222222222222',
        table_label: 'T1',
        expires_at: EXPIRES,
        ...overrides,
      },
    ],
    error: null,
  };
}

/** A database answer: no such live session. */
function noRow() {
  return { data: [], error: null };
}

describe('loadTableAccess', () => {
  it('is "none" when nothing was ever scanned, without calling the database', async () => {
    state.rpc = async () => liveRow();

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('none');
    expect(state.calls).toHaveLength(0);
  });

  it('is "none" for a cookie that does not parse', async () => {
    state.cookie = '{"token":"not-a-token"}';
    const access = await loadTableAccess('maddi');
    expect(access.status).toBe('none');
  });

  it('is verified only when the database says the session is live', async () => {
    state.cookie = cookie();
    state.rpc = async () => liveRow();

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('verified');
    if (access.status !== 'verified') return;
    expect(access.slug).toBe('maddi');
    expect(access.tableLabel).toBe('T1');
    expect(access.session.token).toBe(TOKEN);
    // Asked by token hash inside the database; the cookie's claims are not
    // used for the decision.
    expect(state.calls[0]?.name).toBe('current_table_session');
    expect(state.calls[0]?.args).toEqual({ p_token: TOKEN });
  });

  it('renders the database answer, not the cookie, for label and expiry', async () => {
    // A cookie can say any table number it likes. What the guest is shown is
    // what the session row actually holds.
    state.cookie = cookie({ tableLabel: 'T99', expiresAt: new Date(0).toISOString() });
    state.rpc = async () => liveRow({ table_label: 'T4' });

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('verified');
    if (access.status !== 'verified') return;
    expect(access.tableLabel).toBe('T4');
    expect(access.session.expiresAt).toBe(EXPIRES);
  });

  it('is stale when the database has no live session, even if the cookie looks fresh', async () => {
    state.cookie = cookie();
    state.rpc = async () => noRow();

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('stale');
    if (access.status !== 'stale') return;
    expect(access.qrToken).toBe(QR_TOKEN);
    // The code form, not the card's own address: /t/<token> now opens the menu.
    expect(verifyAgainHref(access)).toBe(`/t/${QR_TOKEN}/code`);
  });

  it('is stale, with no shortcut back, for a cookie written before the card token was kept', async () => {
    state.cookie = cookie({ qrToken: undefined });
    state.rpc = async () => noRow();

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('stale');
    if (access.status !== 'stale') return;
    expect(access.qrToken).toBeNull();
    expect(verifyAgainHref(access)).toBeNull();
  });

  it('is stale for a live session at a different restaurant', async () => {
    // Guests follow links. A verified table in one building is not access to
    // another restaurant's menu, and must never be used to order there.
    state.cookie = cookie();
    state.rpc = async () => liveRow({ restaurant_slug: 'maddi-baner' });

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('stale');
  });

  it('is unverified rather than stale when the database cannot be asked', async () => {
    state.cookie = cookie();
    state.rpc = async () => ({ data: null, error: { message: 'connection refused' } });

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('unavailable');
    // Sending them to re-verify would fail the same way, so there is no
    // shortcut offered here.
    expect(verifyAgainHref(access)).toBeNull();
  });

  it('does not depend on the restaurant slug being supplied', async () => {
    state.cookie = cookie();
    state.rpc = async () => liveRow();

    const access = await loadTableAccess();

    expect(access.status).toBe('verified');
  });
});

/**
 * Browsing without the code.
 *
 * These are the tests for the flow the brief asked for: scanning a live card
 * lets a guest read the menu, and the code is asked for at checkout. The two
 * things that must stay true are that the card is resolved by the DATABASE on
 * every request (not read from the cookie's own claims) and that a dead card
 * cannot browse at all.
 */
describe('loadTableAccess — browsing on a scanned card', () => {
  it('is browse, not none, when a live card is scanned but no code was entered', async () => {
    state.cardCookie = QR_TOKEN;
    state.rpc = async (name) =>
      name === 'public_qr_intro'
        ? {
            data: [
              {
                restaurant_slug: 'maddi',
                restaurant_name: 'Maddi',
                table_label: 'T3',
                window_seconds: 600,
              },
            ],
            error: null,
          }
        : noRow();

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('browse');
    if (access.status !== 'browse') return;
    // The label and slug are the database's answer, not the cookie's.
    expect(access.tableLabel).toBe('T3');
    expect(access.slug).toBe('maddi');
    expect(access.qrToken).toBe(QR_TOKEN);
    expect(access.windowSeconds).toBe(600);
  });

  it('does not browse a revoked card', async () => {
    state.cardCookie = QR_TOKEN;
    // public_qr_intro returns no row for a card that is not live.
    state.rpc = async () => noRow();

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('none');
  });

  it('does not browse another restaurant with a live card for a different one', async () => {
    state.cardCookie = QR_TOKEN;
    state.rpc = async () => ({
      data: [
        {
          restaurant_slug: 'somewhere-else',
          restaurant_name: 'Elsewhere',
          table_label: 'T9',
          window_seconds: 600,
        },
      ],
      error: null,
    });

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('none');
  });

  it('still browses after the session expires, because the card is still on the table', async () => {
    // The cookie holds an expired session AND the card. The session lookup
    // refuses, the card lookup answers: the guest keeps reading the menu and
    // is asked for a fresh code at checkout.
    state.cookie = cookie();
    state.cardCookie = QR_TOKEN;
    state.rpc = async (name) =>
      name === 'current_table_session'
        ? noRow()
        : {
            data: [
              {
                restaurant_slug: 'maddi',
                restaurant_name: 'Maddi',
                table_label: 'T1',
                window_seconds: 600,
              },
            ],
            error: null,
          };

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('browse');
  });

  it('fails closed when the card lookup itself cannot be answered', async () => {
    state.cardCookie = QR_TOKEN;
    state.rpc = async () => ({ data: null, error: { message: 'connection refused' } });

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('unavailable');
  });

  it('ignores a card cookie that is not shaped like a token', async () => {
    state.cardCookie = '<script>alert(1)</script>';
    state.rpc = async () => {
      throw new Error('the database must not be asked with a junk token');
    };

    const access = await loadTableAccess('maddi');

    expect(access.status).toBe('none');
  });
});

describe('verifyAgainHref', () => {
  it('offers the card form only when the card is known', () => {
    expect(verifyAgainHref({ status: 'none' })).toBeNull();
    expect(verifyAgainHref({ status: 'unavailable' })).toBeNull();
    expect(verifyAgainHref({ status: 'demo', tableLabel: null })).toBeNull();
    expect(verifyAgainHref({ status: 'stale', qrToken: null, slug: 'maddi' })).toBeNull();
    expect(verifyAgainHref({ status: 'stale', qrToken: 'abc', slug: 'maddi' })).toBe('/t/abc/code');
    expect(
      verifyAgainHref({
        status: 'browse',
        qrToken: 'qr_abcdefghijklmnop',
        slug: 'maddi',
        tableLabel: 'T1',
        windowSeconds: 600,
      }),
    ).toBe('/t/qr_abcdefghijklmnop/code');
  });
});
