import { NextResponse, type NextRequest } from 'next/server';
import { readGuestOrderStatus } from '@/lib/db/order-status';

/**
 * POST /menu/orders/status
 *
 * One question, one answer: "what is the kitchen doing with this order, right
 * now?" Called by the Orders tab while a guest watches it.
 *
 * WHY POST, FOR A READ
 *
 * The guest's token is in the body, not the query string. A token in a URL is
 * written to access logs, proxy logs, `Referer` headers and the browser's
 * history; this one is the guest's only credential for their own order, and the
 * page it lives on is opened repeatedly over a meal. A body is not logged the
 * same way. Nothing is written by this endpoint, so POST buys no CSRF surface
 * that matters -- and no cookie is consulted for authorisation either way.
 *
 * WHY IT IS NOT CACHEABLE
 *
 * Every response is a claim about the present. A cached "Being cooked" served
 * after the food has arrived is exactly the stale lie this endpoint exists to
 * remove, so `no-store` is set here and `cache: 'no-store'` on the client.
 *
 * WHAT IT NEVER RETURNS
 *
 * - anything but the four status fields (no lines, no totals, no table, no
 *   customer note -- this is a freshness check, not a bill);
 * - the token, in any form;
 * - another restaurant's or another table's order. The database function needs
 *   slug + code + token to match one row, and there is no id-shaped door in.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'cache-control': 'no-store, max-age=0' } as const;

function body(input: unknown): { slug: string; code: string; token: string } {
  const row = (input ?? {}) as Record<string, unknown>;
  const pick = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : '');
  return { slug: pick('s'), code: pick('code'), token: pick('t') };
}

export async function POST(request: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400, headers: NO_STORE });
  }

  const input = body(parsed);

  if (!input.slug.trim() || !input.code.trim() || !input.token.trim()) {
    // A request without all three cannot name an order. It is a client bug or a
    // truncated local record, not a network problem, so it is not retried.
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400, headers: NO_STORE });
  }

  const result = await readGuestOrderStatus(input);

  if (result.kind === 'not_found') {
    /* 200 with ok:false, not 404. The client distinguishes "this order is not
       there" (stop, tell the guest) from "the read failed" (back off and retry);
       a 404 would be swallowed by the retry path and the screen would sit on
       "Reconnecting" for a token that will never work. */
    return NextResponse.json({ ok: false, reason: 'not_found' }, { headers: NO_STORE });
  }

  if (result.kind === 'unavailable') {
    // A real failure: the database refused or did not answer. Worth retrying.
    return NextResponse.json(
      { ok: false, reason: 'unavailable' },
      { status: 503, headers: NO_STORE },
    );
  }

  return NextResponse.json({ ok: true, ...result.snapshot }, { headers: NO_STORE });
}

/** GET is not an alternative access path; it would put the token back in a URL. */
export function GET() {
  return NextResponse.json(
    { ok: false, reason: 'method_not_allowed' },
    { status: 405, headers: { ...NO_STORE, allow: 'POST' } },
  );
}
