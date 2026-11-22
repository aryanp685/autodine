import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261121000200_upi_ref_at_mark_paid.sql', import.meta.url),
  'utf8',
);

function functionBody(): string {
  const start = sql.indexOf('create or replace function public.record_counter_payment(');
  expect(start, 'record_counter_payment is missing from the migration').toBeGreaterThan(-1);
  const open = sql.indexOf('as $$', start);
  const close = sql.indexOf('$$;', open + 5);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(start, close);
}

describe('UPI transaction reference required at Mark Paid', () => {
  it('adds the upi_ref column additively', () => {
    expect(sql).toContain("alter table public.payments add column if not exists upi_ref text;");
  });

  it('documents the column as UPI TRN required for upi only', () => {
    expect(sql).toContain("comment on column public.payments.upi_ref is");
    expect(sql).toContain(
      'UPI transaction reference (UPI TRN) required when method=upi; null for cash/card.',
    );
  });

  it('adds p_upi_ref to the RPC signature with a default', () => {
    const body = functionBody();
    const collapsed = body.replace(/\s+/g, ' ');
    expect(collapsed).toContain('p_upi_ref text default null');
    expect(collapsed).toContain('create or replace function public.record_counter_payment(');
    expect(collapsed).toContain(') returns uuid');
  });

  it('requires a non-blank upi_ref when method is upi (errcode P0001)', () => {
    const body = functionBody();
    expect(body).toContain("p_method = 'upi' and (p_upi_ref is null or trim(p_upi_ref) = '')");
    expect(body).toContain("raise exception 'UPI transaction reference is required.' using errcode = 'P0001'");
  });

  it('stores p_upi_ref on the payments insert', () => {
    const body = functionBody();
    expect(body).toContain('idempotency_key, upi_ref');
    expect(body).toContain("v_key, p_upi_ref");
  });

  it('keeps fixed search_path = public, pg_temp', () => {
    const body = functionBody();
    expect(body).toContain('set search_path = public, pg_temp');
  });

  it('keeps grants unchanged for the new six-parameter signature', () => {
    const sig = 'text, uuid, text, bigint, uuid, text';
    expect(sql).toContain(`revoke all on function public.record_counter_payment(${sig}) from public;`);
    expect(sql).toContain(`revoke all on function public.record_counter_payment(${sig}) from anon;`);
    expect(sql).toContain(`revoke all on function public.record_counter_payment(${sig}) from authenticated;`);
    expect(sql).toContain(`grant execute on function public.record_counter_payment(${sig}) to authenticated;`);
  });

  it('does not modify any existing column (additive only)', () => {
    expect(sql).not.toMatch(/alter table public.payments\s+(drop|alter|rename)\b/is);
  });
});
