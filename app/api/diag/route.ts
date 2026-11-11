/**
 * TEMPORARY sign-in diagnostic.
 *
 * Created to find out why a provisioned review account cannot sign in: the app
 * collapses every auth failure into one deliberately vague sentence, so the
 * real GoTrue error is invisible from the UI.
 *
 * Guarded by a one-off token and deleted as soon as the answer is known.
 * It never belongs in a merge.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SUPABASE_URL, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN = 'diag-8fa31c07';

const REVIEW_USERS = [
  'owner@autodine-review.test',
  'manager@autodine-review.test',
  'kitchen@autodine-review.test',
  'cashier@autodine-review.test',
];

const PASSWORD = 'Review2026!';

type MaybeError = { name?: string; message?: string; status?: number; code?: string };

function describe(error: unknown) {
  if (!error) return null;
  const e = error as MaybeError;
  return { name: e.name ?? null, message: e.message ?? null, status: e.status ?? null, code: e.code ?? null };
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  if (url.searchParams.get('t') !== TOKEN) {
    return new NextResponse('Not found', { status: 404 });
  }

  const out: Record<string, unknown> = {
    supabaseUrl: SUPABASE_URL,
    isSupabaseConfigured,
    isSupabaseAdminConfigured,
  };

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    out.fatal = 'no server client';
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  }

  // 1. The error the login form is hiding.
  const probe = await supabase.auth.signInWithPassword({
    email: REVIEW_USERS[0],
    password: PASSWORD,
  });
  out.signInBeforeFix = {
    error: describe(probe.error),
    hasSession: Boolean(probe.data?.session),
    userId: probe.data?.user?.id ?? null,
  };

  const admin = getSupabaseAdmin();
  if (!admin) {
    out.fatal = 'no admin client: SUPABASE_SECRET_KEY missing or empty';
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  }

  // 2. Does GoTrue even see these users through the Admin API?
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  out.adminListUsers = {
    error: describe(listError),
    total: listed?.users?.length ?? null,
  };

  // 3. Re-set each password through GoTrue's OWN Admin API. This is the real
  //    fix: GoTrue hashes it itself, so the stored hash is by construction in
  //    the format GoTrue will later accept -- unlike a hash we wrote with
  //    pgcrypto's crypt()/gen_salt().
  out.repair = [] as unknown[];
  for (const email of REVIEW_USERS) {
    const target = listed?.users?.find((user) => user.email?.toLowerCase() === email);
    if (!target) {
      (out.repair as unknown[]).push({ email, error: 'not found in auth.users' });
      continue;
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(target.id, {
      password: PASSWORD,
      email_confirm: true,
    });

    const retry = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
    (out.repair as unknown[]).push({
      email,
      updateError: describe(updateError),
      signInError: describe(retry.error),
      hasSession: Boolean(retry.data?.session),
      userId: retry.data?.user?.id ?? null,
    });
  }

  return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
}
