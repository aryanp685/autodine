/**
 * TEMPORARY sign-in diagnostic.
 *
 * Created to find out why a provisioned review account cannot sign in: the app
 * collapses every auth failure into one deliberately vague sentence, so the
 * real GoTrue error is invisible from the UI.
 *
 * Each probe below is independent of the others. That matters: an earlier
 * version gated everything behind a successful user list, so one upstream
 * failure hid every other answer.
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
    at: new Date().toISOString(),
    supabaseUrl: SUPABASE_URL,
    isSupabaseConfigured,
    isSupabaseAdminConfigured,
  };

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    out.fatal = 'no server client';
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  }

  // Probe 1 -- the error the login form is hiding.
  const probe = await supabase.auth.signInWithPassword({
    email: REVIEW_USERS[0],
    password: PASSWORD,
  });
  out.probe1_signInExisting = {
    error: describe(probe.error),
    hasSession: Boolean(probe.data?.session),
    userId: probe.data?.user?.id ?? null,
  };

  // Probe 2 -- is the database reachable at all from this deployment?
  const rest = await supabase.from('profiles').select('id').limit(1);
  out.probe2_rest = { error: describe(rest.error), rows: rest.data?.length ?? null };

  const admin = getSupabaseAdmin();
  if (!admin) {
    out.fatal = 'no admin client: SUPABASE_SECRET_KEY missing or empty';
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  }

  // Probe 3 -- can GoTrue READ the auth schema?
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  out.probe3_adminList = {
    error: describe(listError),
    total: listed?.users?.length ?? null,
    emails: (listed?.users ?? []).map((u) => u.email).slice(0, 30),
  };

  // Probe 4 -- can GoTrue WRITE to the auth schema? A brand new user proves
  // the write path independently of whether the existing rows are readable.
  const freshEmail = `diag-${Date.now()}@autodine-review.test`;
  const created = await admin.auth.admin.createUser({
    email: freshEmail,
    password: PASSWORD,
    email_confirm: true,
  });
  out.probe4_adminCreate = {
    email: freshEmail,
    error: describe(created.error),
    userId: created.data?.user?.id ?? null,
  };

  // Probe 5 -- and can a GoTrue-created user then sign in?
  if (created.data?.user?.id) {
    const retry = await supabase.auth.signInWithPassword({ email: freshEmail, password: PASSWORD });
    out.probe5_signInFresh = {
      error: describe(retry.error),
      hasSession: Boolean(retry.data?.session),
      userId: retry.data?.user?.id ?? null,
    };
    await admin.auth.admin.deleteUser(created.data.user.id);
  }

  // Probe 6 -- last attempt at the real goal: make the four review accounts
  // work by having GoTrue itself re-hash their passwords.
  out.probe6_repair = [];
  for (const email of REVIEW_USERS) {
    const target = listed?.users?.find((user) => user.email?.toLowerCase() === email);
    if (!target) {
      (out.probe6_repair as unknown[]).push({ email, skipped: 'not returned by listUsers' });
      continue;
    }
    const { error: updateError } = await admin.auth.admin.updateUserById(target.id, {
      password: PASSWORD,
      email_confirm: true,
    });
    const retry = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
    (out.probe6_repair as unknown[]).push({
      email,
      updateError: describe(updateError),
      signInError: describe(retry.error),
      hasSession: Boolean(retry.data?.session),
    });
  }

  return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
}
