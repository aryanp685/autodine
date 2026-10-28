/**
 * Admin: renew a restaurant's trial.
 *
 * POST /api/admin/renew-trial
 *
 * Body: { restaurantName: string }
 *
 * This is a server-side only endpoint. It uses the admin Supabase client
 * (service role), which bypasses RLS. It must never be called from
 * client-side code — the admin client must never reach the browser bundle.
 *
 * The trial renewal sets `trial_started_at` to `now()`, starting a fresh
 * 7-day trial. The `protect_restaurant_plan()` trigger allows this because
 * auth.uid() is null (service role).
 */

import { NextResponse } from 'next/server';
import { renewTrialAction } from '@/app/admin/renew-trial/actions';

export async function POST(request: Request): Promise<NextResponse> {
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

  const result = await renewTrialAction(restaurantName);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    restaurantName: result.restaurantName,
    trialEndsAt: result.trialEndsAt,
  });
}
