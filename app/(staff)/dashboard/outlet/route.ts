/**
 * Switch the outlet this browser is looking at.
 *
 * POST from the switcher in the dashboard bar (components/OutletSwitcher.tsx).
 * A route handler rather than a server action so the control works without
 * JavaScript; the trade is that the origin check a server action gets for free
 * has to be written here -- see sameOrigin() in lib/outlets.ts.
 *
 * The submitted id is only a preference. It is checked against the caller's
 * memberships before the cookie is written, so a hand-made POST naming an
 * outlet the caller does not belong to is refused rather than honoured.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { OUTLET_COOKIE, sameOrigin, safeReturnPath } from '@/lib/outlets';

export const dynamic = 'force-dynamic';

function backTo(request: NextRequest, path: string, message: string) {
  const url = new URL(path, request.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 });
  }

  const form = await request.formData();
  const target = String(form.get('outlet') ?? '');
  const next = safeReturnPath(String(form.get('next') ?? ''));

  const staff = await getStaffContextDetailed();
  if (!staff.ok) {
    if (staff.reason === 'unconfigured') {
      return backTo(request, next, 'The database is not connected, so outlets cannot be switched.');
    }
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }

  if (!staff.context.outlets.some((outlet) => outlet.id === target)) {
    return backTo(request, next, 'That outlet is not on this account.');
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set({
    name: OUTLET_COOKIE,
    value: target,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: request.nextUrl.protocol === 'https:',
  });

  return response;
}
