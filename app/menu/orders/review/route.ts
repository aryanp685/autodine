import { readJsonObject, JsonInputError } from '@/lib/http-json';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * POST /menu/orders/review
 *
 * The guest submits the in-app review from the invitation sheet: stars plus an
 * optional note. The whole write is one SECURITY DEFINER RPC,
 * `submit_order_review(p_guest_token, p_order_id, p_rating, p_note)`, which
 * matches the token against the order row -- a guessed order id without its
 * token writes nothing, and there is no direct table grant to anon at all.
 *
 * WHY POST, AND WHY THE TOKEN STAYS IN THE BODY
 *
 * Same reasoning as /menu/orders/status: the token is the guest's only
 * credential and must not reach URLs, logs or history. This endpoint writes,
 * so POST is also the honest verb. Responses are `no-store` for the same
 * freshness reason as the status read.
 *
 * Errors come back as 200 `{ok:false,error}` whenever they are the guest's to
 * fix or dismiss (bad link, stale sheet); 503 only for a real database
 * failure worth a retry.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'cache-control': 'no-store, max-age=0' } as const;

export async function POST(request: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await readJsonObject(request);
  } catch (error) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: error instanceof JsonInputError ? error.status : 400, headers: NO_STORE });
  }

  const row = (parsed ?? {}) as Record<string, unknown>;
  const orderId = typeof row.orderId === 'string' ? row.orderId.trim() : '';
  const token = typeof row.token === 'string' ? row.token.trim() : '';
  const rating = typeof row.rating === 'number' ? Math.round(row.rating) : Number.NaN;
  const note = typeof row.note === 'string' ? row.note : '';

  if (!orderId || !token || !Number.isInteger(rating) || rating < 1 || rating > 5 || note.length > 500) {
    // A rejected shape is a client bug or a stale sheet, not a network problem.
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400, headers: NO_STORE });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    // Demo / test builds without a database have nothing to write to. The
    // guest's tap is acknowledged and the sheet moves on; this is the same
    // graceful trade the rest of the demo mode makes.
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const { data, error } = await admin.rpc('submit_order_review', {
    p_guest_token: token,
    p_order_id: orderId,
    p_rating: rating,
    p_note: note,
  });

  if (error) {
    // A real database failure: worth a retry from the error state.
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (result && result.ok === false) {
    return NextResponse.json({ ok: false, error: result.error ?? 'not_valid' }, { headers: NO_STORE });
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

/** GET is not an alternative access path; it would put the token in a URL. */
export function GET() {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { ...NO_STORE, allow: 'POST' } },
  );
}
