/**
 * Open a second (third, ...) outlet on the same account.
 *
 * POST from the Outlets card on Settings. The insert itself happens inside
 * `create_outlet()` -- see supabase/migrations/20261022000700_multi_outlet.sql
 * -- because there is no INSERT policy on public.restaurants and there must
 * not be one: an authenticated user who could insert restaurants directly
 * could create workspaces in a loop, each with a fresh trial.
 *
 * The name and slug are validated in both places on purpose. Here so the
 * owner reads a sentence instead of a Postgres exception; there so a caller
 * who is not this form cannot skip the check.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { OUTLET_COOKIE, outletNameProblem, sameOrigin } from '@/lib/outlets';
import { slugify, uniqueSlug } from '@/lib/slug';

export const dynamic = 'force-dynamic';

const SETTINGS_PATH = '/dashboard/settings';

function back(request: NextRequest, key: 'error' | 'notice', message: string) {
  const url = new URL(SETTINGS_PATH, request.url);
  url.searchParams.set(key, message);
  return NextResponse.redirect(url, 303);
}

const REFUSALS: Array<{ code: string; message: string }> = [
  { code: 'outlet_limit', message: 'This account already has the maximum of five outlets.' },
  { code: 'name_invalid', message: 'Give the outlet a name of at least two characters.' },
  { code: 'slug_invalid', message: 'That name could not be turned into a web address. Try letters and numbers.' },
  { code: 'slug_taken', message: 'Another restaurant already uses that web address. Try a slightly different name.' },
  { code: 'unauthenticated', message: 'Sign in again to add an outlet.' },
];

export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 });
  }

  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim();

  const problem = outletNameProblem(name);
  if (problem) return back(request, 'error', problem);

  const staff = await getStaffContextDetailed();
  if (!staff.ok) {
    if (staff.reason === 'unconfigured') {
      return back(request, 'error', 'The database is not connected, so no outlet can be created.');
    }
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }

  const { supabase } = staff.context;

  // Readable address from the name. The uniqueness check here can lose a race
  // with another signup -- the unique index is the real guard, and 23505 below
  // is what a lost race looks like.
  const slug = await uniqueSlug(slugify(name), async (candidate) => {
    const { data } = await supabase.from('restaurants').select('id').eq('slug', candidate).maybeSingle();
    return Boolean(data);
  });

  const { data, error } = await supabase.rpc('create_outlet', { p_name: name, p_slug: slug });

  if (error) {
    const refusal = REFUSALS.find((entry) => error.message.includes(entry.code));
    if (refusal) return back(request, 'error', refusal.message);
    if (error.code === '23505') return back(request, 'error', REFUSALS[3].message);
    console.error('[autodine] could not create outlet:', error.message);
    return back(request, 'error', 'The outlet could not be created. Please try again.');
  }

  if (!data) return back(request, 'error', 'The outlet could not be created. Please try again.');

  const response = NextResponse.redirect(
    new URL(
      `${SETTINGS_PATH}?notice=${encodeURIComponent(
        `${name} is open. Set its details and tax rate here, then build its menu.`,
      )}`,
      request.url,
    ),
    303,
  );

  // Land in the new outlet: an owner who just created one expects to be
  // looking at it, not at the old one.
  response.cookies.set({
    name: OUTLET_COOKIE,
    value: String(data),
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: request.nextUrl.protocol === 'https:',
  });

  return response;
}
