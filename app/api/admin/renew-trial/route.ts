/**
 * Admin: renew a restaurant's trial.
 *
 * POST /api/admin/renew-trial
 *
 * Headers: Authorization: Bearer <ADMIN_SECRET>
 * Body: { restaurantName: string }
 *
 * THE GATE
 *
 * Every request must carry the server's admin secret (lib/admin-auth.ts),
 * compared in constant time and rejected generically. Authorization is
 * checked before the body is even parsed, so an unauthorized caller cannot
 * distinguish this endpoint from a wall. The privileged action repeats the
 * same check itself — protecting the route alone would leave every other
 * path into the write open.
 *
 * This endpoint uses the admin Supabase client (service role), which
 * bypasses RLS. It must never be called from client-side code — the admin
 * client must never reach the browser bundle.
 *
 * The trial renewal sets `trial_started_at` to `now()`, starting a fresh
 * 7-day trial. The `protect_restaurant_plan()` trigger allows this because
 * auth.uid() is null (service role).
 */

import { NextResponse } from 'next/server';
import { renewTrialAction } from '@/app/admin/renew-trial/actions';
import { isValidAdminSecret, UNAUTHORIZED_MESSAGE } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The secret from the Authorization header, or null when absent. */
function bearerSecret(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  // Authorization first: nothing else about this endpoint answers an
  // unauthorized caller.
  const providedSecret = bearerSecret(request);
  if (!isValidAdminSecret(providedSecret)) {
    return NextResponse.json({ error: UNAUTHORIZED_MESSAGE }, { status: 401 });
  }

  let body: { restaurantName?: string };
  try {
    body = await request.json() as { restaurantName?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const restaurantName = body.restaurantName?.trim();
  if (!restaurantName) {
    return NextResponse.json({ error: 'Missing restaurantName' }, { status: 400 });
  }

  // The action verifies the same secret again by itself — defence in depth
  // for every future caller that reaches it without passing through here.
  const result = await renewTrialAction(restaurantName, providedSecret ?? '');

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Unknown error' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    restaurantName: result.restaurantName,
    trialEndsAt: result.trialEndsAt,
  });
}
