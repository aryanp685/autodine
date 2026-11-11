/**
 * TEMPORARY sign-in diagnostic and repair.
 *
 * Why this exists: the login form deliberately collapses every auth failure
 * into one vague sentence, so the real GoTrue error was invisible. Probes
 * showed GoTrue itself is healthy -- it can create a user and sign that user
 * in -- but every operation that READS the pre-existing rows in auth.users
 * fails with "Database error querying schema".
 *
 * So this route does two things:
 *   1. Reads every user by id, to find which specific rows GoTrue cannot read.
 *   2. Re-hashes the four review accounts through GoTrue's own Admin API,
 *      which does not depend on listUsers, then proves each one can sign in.
 *
 * Guarded by a one-off token and deleted as soon as it has served its
 * purpose. It never belongs in a merge.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SUPABASE_URL, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN = 'diag-8fa31c07';

const PASSWORD = 'Review2026!';

/** Every user currently in auth.users, from `select id, email from auth.users`. */
const ALL_USERS: Array<{ id: string; email: string }> = [
  { id: 'a6f2c759-fc54-4c3c-8178-50f0f3a8ce11', email: 'owner@autodine-review.test' },
  { id: 'ee86b6a9-2bca-470e-abe7-2a50121a0362', email: 'manager@autodine-review.test' },
  { id: '727a36e0-f7e4-43ce-a27b-bc94473c996f', email: 'kitchen@autodine-review.test' },
  { id: 'd499e721-38a8-4f37-93a5-21cbf3d53381', email: 'cashier@autodine-review.test' },
  { id: '80785b42-690c-4eaa-83a1-02adf7b3d54d', email: 'arena-0add67c3@example.invalid' },
  { id: '43ec3eb9-4ba7-4592-a13b-0701c70df220', email: 'arena-1da84209@example.invalid' },
  { id: 'f8e3fc11-242d-458d-8a26-b1bef91544a6', email: 'arena-3c06f80b@example.invalid' },
  { id: '204d7ee0-d140-429b-a5a2-2348040b9c67', email: 'arena-6fe81052@example.invalid' },
  { id: 'faa036ae-0b9b-4256-9331-76370c662a36', email: 'arena-8cef1565@example.invalid' },
  { id: '81aa3ab2-40bb-4eed-8c51-108b6ff1aa66', email: 'arena-a715f820@example.invalid' },
  { id: 'd8ddb4ea-e2b2-4031-a852-c386358733c9', email: 'arena-c73d7fe1@example.invalid' },
  { id: '66090623-4a42-4ecf-a028-a10c5b7b606f', email: 'arena-cd483a60@example.invalid' },
  { id: '56f3cb05-f7d0-4105-a494-46cfc89f12d5', email: 'arena-e5994dc2@example.invalid' },
  { id: '6e2d6894-2249-4952-b99c-38e2fc460073', email: 'kingprateek255@gmail.com' },
];

const REVIEW_EMAILS = [
  'owner@autodine-review.test',
  'manager@autodine-review.test',
  'kitchen@autodine-review.test',
  'cashier@autodine-review.test',
];

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
  const admin = getSupabaseAdmin();
  if (!supabase || !admin) {
    out.fatal = !supabase ? 'no server client' : 'no admin client';
    return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
  }

  // 1. Which rows can GoTrue actually read? One call per id, so a single bad
  //    row cannot mask the result for all the others.
  out.readById = [];
  for (const user of ALL_USERS) {
    const { data, error } = await admin.auth.admin.getUserById(user.id);
    (out.readById as unknown[]).push({
      email: user.email,
      ok: Boolean(data?.user),
      error: describe(error),
    });
  }

  // 2. The actual fix: let GoTrue hash the password itself, by id, without
  //    going anywhere near listUsers.
  out.repair = [];
  for (const email of REVIEW_EMAILS) {
    const id = ALL_USERS.find((user) => user.email === email)?.id;
    if (!id) {
      (out.repair as unknown[]).push({ email, skipped: 'no id' });
      continue;
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(id, {
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
