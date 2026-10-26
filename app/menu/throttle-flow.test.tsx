import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * A THROTTLED GUEST, WALKED THROUGH THE REAL SCREENS.
 *
 * WHY THIS FILE EXISTS
 *
 * The previous round proved two halves of this separately, and the join between
 * them was an assumption: the route test checked that a `limited` answer became
 * `?v=throttled` plus a cookie, and the screen test checked that a component
 * given a notice rendered one. Neither could fail if the two disagreed — a
 * renamed parameter, a cookie written under a different name, a message built
 * twice and drifting. And the demonstration of the live behaviour was `curl
 * '/menu?v=throttled'`, which is exactly the shortcut this file replaces: a URL
 * anybody can type is not evidence that a refused scan produces it.
 *
 * WHAT IS REAL HERE
 *
 *   the route handler   app/t/[token]/route.ts — its real GET()
 *   the access check    lib/table-access.ts — real, reading the real cookies
 *   the page            app/menu/page.tsx — the real default export, rendered
 *   the screen          components/screens/CustomerMenu.tsx — real
 *   the order path      app/menu/checkout/actions.ts — the real server action
 *
 * WHAT IS NOT
 *
 *   Supabase. There is no database in this environment, so the RPCs answer from
 *   a table that is written to the SQL's own contract — five columns, status
 *   words, null for everything else. That is the boundary a database would sit
 *   behind; everything on this side of it is the code that ships.
 *
 * The honest limit of this file is therefore: it proves the APPLICATION handles
 * the database's refusal correctly. It does not prove Postgres refuses at ten
 * opens per card. That is what supabase/checks/06_scan_limits.sql does, and it
 * needs a database — see docs/scan-throttle-coverage.md.
 */

const mocks = vi.hoisted(() => ({
  /** rpc(name, params) answers with { data, error }; every call is recorded. */
  rpc: vi.fn(),
  calls: [] as { name: string; params: Record<string, unknown> }[],
  jar: new Map<string, string>(),
}));

/* The cookie jar the browser would carry between these requests. */
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...mocks.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void mocks.jar.set(name, value),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
}));

vi.mock('@/lib/supabase/env', () => ({
  isSupabaseConfigured: true,
  isSupabaseAdminConfigured: false,
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: '',
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, params: Record<string, unknown>) => {
      mocks.calls.push({ name, params });
      return mocks.rpc(name, params);
    },
  }),
}));

vi.mock('next/navigation', () => ({
  // Next unwinds a redirect by throwing; the same shape keeps the flow intact.
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error('not-found');
  },
}));

/* The screen under test draws its cart from a provider that needs a browser.
   A passthrough provider plus an empty cart keeps the markup of the page itself
   honest while leaving the guest with nothing in the cart to render. */
vi.mock('@/components/CartProvider', () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => children,
  useCart: () => ({
    lines: [],
    count: 0,
    ready: true,
    add: () => {},
    remove: () => {},
    setQty: () => {},
    clear: () => {},
  }),
}));

vi.mock('@/lib/db/menu-screen', () => ({
  getMenuScreenData: async () => ({
    restaurant: {
      slug: 'maddi',
      name: 'Maddi',
      tagline: 'Wood-fired',
      address: 'Nagpur',
      phone: '000',
      gstin: '',
      fssai: '',
      currency: 'INR',
      openHours: '11am to 11pm',
      timezone: 'Asia/Kolkata',
    },
    categories: [{ id: 'c1', name: 'Main Course', count: 1 }],
    items: [
      {
        id: 'i1',
        name: 'Butter Chicken',
        desc: 'Slow-cooked in a tomato gravy',
        price: 469,
        category: 'c1',
        veg: false,
        available: true,
      },
    ],
    table: null,
  }),
}));

const { GET } = await import('@/app/t/[token]/route');
const { default: CustomerMenuPage } = await import('@/app/menu/page');
const { placeOrderAction } = await import('@/app/menu/checkout/actions');

const CARD = '618d77118ea89cbfb12c4a70d9267858cf06d34dc0f6db49';
const LIVE_SESSION = {
  token: 'a'.repeat(64),
  slug: 'maddi',
  tableLabel: 'T3',
  expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
};

/**
 * `open_table_session`'s own contract, exactly: five columns, and a refusal is
 * a status word with everything else null (migration 20261028000900, lines
 * 179-181 for the card limit and 188-190 for the address limit).
 */
function limited(extra: Record<string, unknown> = {}) {
  return {
    data: [
      {
        status: 'limited',
        session_token: null,
        restaurant_slug: 'maddi',
        table_label: 'T3',
        expires_at: null,
        ...extra,
      },
    ],
    error: null,
  };
}

function opened() {
  return {
    data: [
      {
        status: 'opened',
        session_token: LIVE_SESSION.token,
        restaurant_slug: 'maddi',
        table_label: 'T3',
        expires_at: LIVE_SESSION.expiresAt,
      },
    ],
    error: null,
  };
}

/** The dispatcher: what the database answers, by function name. */
function database(answers: {
  open?: () => unknown;
  session?: unknown[] | null;
  place?: (params: Record<string, unknown>) => unknown;
}) {
  mocks.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
    if (name === 'public_qr_intro') {
      return {
        data: [{ restaurant_slug: 'maddi', table_label: 'T3', window_seconds: 600 }],
        error: null,
      };
    }
    if (name === 'current_table_session') {
      const rows = answers.session ?? [];
      return { data: rows, error: null };
    }
    if (name === 'open_table_session') return answers.open?.() ?? { data: [], error: null };
    if (name === 'place_public_order') return answers.place?.(params) ?? { data: null, error: null };
    return { data: null, error: null };
  });
}

/** Follow the redirect a scan produces, exactly as a browser would. */
async function scanTheCard() {
  const request = new NextRequest(`http://localhost:3000/t/${CARD}`, {
    headers: { 'x-forwarded-for': '203.0.113.7' },
  });
  const response = await GET(request, { params: Promise.resolve({ token: CARD }) });

  // The browser stores what the response told it to store.
  for (const cookie of response.cookies.getAll()) {
    if (!cookie.value) mocks.jar.delete(cookie.name);
    else mocks.jar.set(cookie.name, cookie.value);
  }

  const location = new URL(response.headers.get('location') ?? '', 'http://localhost:3000');
  return {
    response,
    location,
    params: Object.fromEntries(location.searchParams) as Record<string, string>,
  };
}

/** Render the real page at the address the scan sent us to. */
async function renderPageAt(params: Record<string, string>) {
  const tree = await CustomerMenuPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(tree);
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkoutForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set('slug', 'maddi');
  data.set('lines', JSON.stringify([{ itemId: 'i1', qty: 2 }]));
  data.set('attempt', '9f4b6c1e-2d3a-4b5c-8d7e-0a1b2c3d4e5f');
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

async function place(form: FormData): Promise<string> {
  try {
    await placeOrderAction(form);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('redirect:')) return message.slice('redirect:'.length);
    throw error;
  }
  throw new Error('placeOrderAction returned instead of redirecting');
}

beforeEach(() => {
  mocks.jar.clear();
  mocks.calls.length = 0;
  mocks.rpc.mockReset();
});

describe('a scan the database refuses for rate limiting', () => {
  async function refusedScan() {
    database({ open: () => limited() });
    const scan = await scanTheCard();
    return scan;
  }

  it('is what puts the guest on a notice — not a URL typed by hand', async () => {
    const { response, params } = await refusedScan();

    // The refusal is in the address the browser actually followed...
    expect(response.status).toBe(307);
    expect(params.v).toBe('throttled');
    expect(params.s).toBe('maddi');

    // ...and it was recorded, so the next screens know.
    expect(mocks.jar.get('autodine_throttled')).toBe('throttled');
    // ...without a session, which is the one thing that would make it a bypass.
    expect(mocks.jar.has('autodine_table')).toBe(false);
    expect(mocks.jar.get('autodine_table_card')).toBe(CARD);
  });

  it('shows the guest an explanation and a next step, above the food', async () => {
    const { params } = await refusedScan();
    const html = await renderPageAt(params);
    const text = visibleText(html);

    // A clear, actionable message on the real customer screen.
    expect(text).toContain('Table check paused');
    expect(text).toContain('scanned unusually often');
    expect(text).toContain('order with staff');
    // ...and the menu itself is still theirs to read.
    expect(text).toContain('Butter Chicken');
    // It is placed before the menu list, not after it.
    expect(html.indexOf('data-throttle-note')).toBeLessThan(html.indexOf('Butter Chicken'));
  });

  it('is caused by the refusal, not by rendering the menu', async () => {
    /*
     * The control. Same route, same page, same component — the only difference
     * is the database's answer. Without this, a banner that rendered for every
     * guest would still pass every test above.
     */
    database({ open: () => opened() });
    const { params } = await scanTheCard();
    const html = await renderPageAt(params);
    const text = visibleText(html);

    expect(params.v).toBeUndefined();
    expect(html).not.toContain('data-throttle-note');
    expect(text).not.toContain('Table check paused');
    expect(text).toContain('Butter Chicken');
    // …and the session the database minted is the one the browser was given.
    expect(JSON.parse(mocks.jar.get('autodine_table') ?? '{}').token).toBe(LIVE_SESSION.token);
  });

  it('does not claim the order went anywhere', async () => {
    const { params } = await refusedScan();
    const text = visibleText(await renderPageAt(params)).toLowerCase();

    for (const lie of [
      'order placed',
      'order confirmed',
      'sent to the kitchen',
      'we saved',
      'your order is on its way',
    ]) {
      expect(text, lie).not.toContain(lie);
    }
  });

  it('does not send the guest to a code form, or to a waiter, for a code', async () => {
    const { params } = await refusedScan();
    const text = visibleText(await renderPageAt(params)).toLowerCase();

    // In this restaurant there is no rotating code to ask for. Offering one
    // would be a dead end with a form in front of it.
    expect(text).not.toContain('enter the code');
    expect(text).not.toContain('ask a waiter');
    expect(text).not.toContain('scan the qr');
  });

  it('refuses the order, writes nothing, and says which of those happened', async () => {
    const { params } = await refusedScan();
    await renderPageAt(params); // the guest browsed first
    mocks.calls.length = 0;

    const target = await place(checkoutForm());
    const url = new URL(target, 'http://localhost:3000');
    const message = url.searchParams.get('error') ?? '';

    expect(url.pathname).toBe('/menu/cart');
    // The cart is not lost: the slug that keys it is in the address.
    expect(url.searchParams.get('s')).toBe('maddi');
    expect(message.startsWith('Your order was not sent.')).toBe(true);
    expect(message).toContain('cart is safe');
    // Nothing was written: no insert, no RPC, no second order.
    expect(mocks.calls.filter((call) => call.name === 'place_public_order')).toEqual([]);
    // And not the code page, which cannot help this guest.
    expect(target).not.toContain('/code');
  });

  it('keeps the cart and the refusal consistent when they retry immediately', async () => {
    // Retrying while still throttled must be a second honest refusal, not a
    // success and not a different message.
    const { params } = await refusedScan();
    await renderPageAt(params);

    const first = await place(checkoutForm());
    const second = await place(checkoutForm());

    expect(second).toBe(first);
    expect(mocks.calls.filter((call) => call.name === 'place_public_order')).toEqual([]);
  });
});

describe('what the guest is told about waiting', () => {
  it("invents nothing when the database reports no wait — today's contract", async () => {
    database({ open: () => limited() });
    const { params } = await scanTheCard();
    const text = visibleText(await renderPageAt(params));

    // The function returns five columns and no retry time, so the screen says
    // so vaguely rather than picking a number.
    expect(text).toContain('a short while');
    expect(text).not.toMatch(/\d+ minutes/);

    const url = new URL(await place(checkoutForm()), 'http://localhost:3000');
    const message = url.searchParams.get('error') ?? '';
    expect(message).toContain('in a few minutes');
    expect(message).not.toMatch(/\d+ minutes/);
  });

  it('quotes the wait when the database does report one, in both places', async () => {
    /*
     * Not reachable on today's schema — `open_table_session` has no retry
     * column — but this is the contract the app is written to: the day the
     * function returns `retry_after_seconds`, the guest is told it. The
     * alternative, silence followed by "a short while", is how a retry hint
     * gets lost between the database and the screen.
     */
    database({ open: () => limited({ retry_after_seconds: 600 }) });
    const { params } = await scanTheCard();
    const text = visibleText(await renderPageAt(params));

    expect(params.v).toBe('throttled.600');
    expect(mocks.jar.get('autodine_throttled')).toBe('throttled.600');
    expect(text).toContain('paused for about 10 minutes');

    const url = new URL(await place(checkoutForm()), 'http://localhost:3000');
    expect(url.searchParams.get('error')).toContain('try again in about 10 minutes');
  });

  it('ignores a wait a guest edited into the cookie', async () => {
    // The flag is guest-controlled input. A negative or absurd suffix is not a
    // throttle at all, and must not become "in about -3 minutes".
    database({ open: () => limited() });
    const { params } = await scanTheCard();
    mocks.jar.set('autodine_throttled', 'throttled.-5');

    const text = visibleText(await renderPageAt({ ...params, v: '' }));
    expect(text).toContain('a short while');
    expect(text).not.toContain('-5');

    mocks.jar.set('autodine_throttled', 'throttled.999999999');
    const big = visibleText(await renderPageAt({ ...params, v: '' }));
    expect(big).toContain('a short while');
  });
});

describe('an order the guest already has', () => {
  it('is not duplicated by a retry: the same attempt key is re-sent', async () => {
    /*
     * The database makes a re-post safe by returning the order the key already
     * wrote (migration 20261027000900). That only works if the app re-sends the
     * same key — so this pins the app's half: two presses of Place order carry
     * one `p_guest_token`, and both land on one order.
     */
    database({
      session: [{ restaurant_slug: 'maddi', table_label: 'T3', expires_at: LIVE_SESSION.expiresAt }],
      place: () => ({ data: 'A-1042', error: null }),
    });
    mocks.jar.set('autodine_table', JSON.stringify(LIVE_SESSION));

    const first = await place(checkoutForm());
    const second = await place(checkoutForm());

    const attempts = mocks.calls
      .filter((call) => call.name === 'place_public_order')
      .map((call) => call.params.p_guest_token);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toBe('9f4b6c1e-2d3a-4b5c-8d7e-0a1b2c3d4e5f');
    expect(attempts[1]).toBe(attempts[0]);

    // Both presses open the SAME order, with the same private token.
    expect(second).toBe(first);
    expect(first).toContain('code=A-1042');
    expect(first).toContain('t=9f4b6c1e-2d3a-4b5c-8d7e-0a1b2c3d4e5f');
  });

  it('is left alone by a throttled scan — nothing is written over it', async () => {
    // A guest with a live session and an order on the table, whose next scan is
    // refused. Their order must not be touched, re-created or lost.
    database({
      open: () => limited(),
      session: [{ restaurant_slug: 'maddi', table_label: 'T3', expires_at: LIVE_SESSION.expiresAt }],
    });
    mocks.jar.set('autodine_table', JSON.stringify(LIVE_SESSION));

    const { params, response } = await scanTheCard();

    // Already verified: the scan goes straight back to the menu, and the stale
    // "paused" note is cleared, because it no longer describes this guest.
    expect(response.headers.get('location')).not.toContain('v=');
    expect(mocks.jar.get('autodine_throttled')).toBeUndefined();
    expect(params.s).toBe('maddi');

    const text = visibleText(await renderPageAt(params));
    expect(text).toContain('Butter Chicken');
    expect(text).not.toContain('Table check paused');
    // The refused scan did not even ask to open a session.
    expect(mocks.calls.filter((call) => call.name === 'open_table_session')).toEqual([]);
    expect(mocks.calls.filter((call) => call.name === 'place_public_order')).toEqual([]);
  });
});
