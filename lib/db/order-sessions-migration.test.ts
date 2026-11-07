import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261108000500_order_sessions.sql', import.meta.url),
  'utf8',
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing from the migration`).toBeGreaterThan(-1);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(start, close);
}

describe('order sessions migration guards', () => {
  const body = functionBody('place_public_order');

  it('separates the durable bill session from the short-lived QR verification session', () => {
    expect(sql).toContain('create table if not exists public.order_sessions');
    expect(sql).toContain('add column if not exists order_session_id uuid');
    expect(sql).toContain('references public.order_sessions(id) on delete set null');
    expect(sql).toContain('table_session_id, which is the short-lived QR verification session');
  });

  it('enforces one open sitting per table and allows a fresh one after close', () => {
    expect(sql).toContain('create unique index if not exists order_sessions_open_unique');
    expect(sql).toContain('where status = \'open\'');
    expect(body).toContain('on conflict (table_id) where status = \'open\'');
    expect(body).toContain('do update set table_id = excluded.table_id');
    expect(body).toContain('returning id into v_order_session_id');
    expect(body).toContain('set order_session_id = v_order_session_id');
  });

  it('keeps session rows tenant-scoped and read-only to authenticated staff', () => {
    expect(sql).toContain('alter table public.order_sessions enable row level security');
    expect(sql).toContain('where m.restaurant_id = order_sessions.restaurant_id');
    expect(sql).toContain('and m.user_id = auth.uid()');
    expect(sql).toContain('grant select on public.order_sessions to authenticated');
    expect(sql).not.toMatch(/grant\s+(?:all|insert|update|delete)\s+on\s+public\.order_sessions/i);
    expect(sql).toContain('revoke all on public.order_sessions from anon');
  });

  it('preserves replay protection before any new order or session work', () => {
    const replay = body.indexOf('if p_guest_token is not null');
    const core = body.indexOf('place_public_order_core(');
    const sessionAttach = body.indexOf('insert into public.order_sessions');
    expect(replay).toBeGreaterThan(-1);
    expect(core).toBeGreaterThan(replay);
    expect(sessionAttach).toBeGreaterThan(core);
    expect(body).toContain('when unique_violation then');
    expect(body).toContain('where o.guest_token = p_guest_token');
    expect(body).toContain('perform public.stamp_guest_verification');
  });

  it('retains the existing guest ordering safeguards', () => {
    expect(body).toContain('public.hit_rate_limit(');
    expect(body).toContain('public.place_public_order_core(p_slug, p_lines, p_note, p_session_token)');
    expect(body).toContain('public.stamp_guest_verification(v_code, v_restaurant_id, btrim(p_session_token))');
    expect(body).toContain('tax_rate_bps_snapshot');
    expect(body).toContain('security definer');
    expect(body).toContain('set search_path = public, pg_temp');
  });
});
