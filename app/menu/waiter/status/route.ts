import { NextResponse } from 'next/server';
import { JsonInputError, readJsonObject } from '@/lib/http-json';
import { sameOrigin } from '@/lib/outlets';
import { readTableSession } from '@/lib/table-session';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  if (!sameOrigin(request.headers.get('origin'), request.headers.get('host'))) return reply({ ok: false }, 403);
  let scope: Record<string, unknown>;
  try { scope = await readJsonObject(request, 1024); }
  catch (error) { return reply({ ok: false }, error instanceof JsonInputError ? error.status : 400); }
  const { slug, table } = scope;
  if (typeof slug !== 'string' || typeof table !== 'string' || !slug || !table || slug.length > 128 || table.length > 128) return reply({ ok: false }, 400);
  const session = await readTableSession();
  if (!session) return reply({ ok: true, state: 'expired' });
  const client = await createSupabaseServerClient();
  if (!client) return reply({ ok: false }, 503);
  const { data, error } = await client.rpc('read_verified_waiter_state', { p_slug: slug, p_table_label: table, p_session_token: session.token })
    .abortSignal(request.signal);
  return error || !data ? reply({ ok: false }, 503) : reply({ ok: true, state: data });
}
