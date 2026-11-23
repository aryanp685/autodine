import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261124000100_mark_paid_method.sql', import.meta.url),
  'utf8',
);

/**
 * Contract test for the method-aware manual settlement migration. It guards
 * the same invariants the cashier path enforces: the ledger row and the audit
 * event carry the method the staff member states, UPI cannot settle without a
 * transaction reference, and idempotency keys cannot collide across methods.
 */
describe('20261124000100_mark_paid_method.sql', () => {
  it('replaces the one-argument function with the method-aware signature', () => {
    expect(sql).toContain('drop function if exists public.mark_order_session_paid(uuid);');
    expect(sql).toContain('p_order_session_id uuid,');
    expect(sql).toContain('p_method text,');
    expect(sql).toContain('p_upi_ref text');
  });

  it('validates the method against the ledger-accepted values', () => {
    expect(sql).toContain("if p_method not in ('cash', 'card', 'upi', 'manual') then");
  });

  it('requires the UPI transaction reference, like the cashier screen', () => {
    expect(sql).toContain("raise exception 'UPI transaction reference is required.' using errcode = 'P0001'");
    expect(sql).toContain("case when p_method = 'upi' then trim(p_upi_ref) end");
  });

  it('keys payments per method so retries cannot collide across methods', () => {
    expect(sql).toContain("'manual-session:' || p_method || ':'");
  });

  it('rejects a retry whose recorded method differs from the requested one', () => {
    expect(sql).toContain('or v_existing.method <> p_method');
  });

  it('carries the stated method into the ledger row and the audit event', () => {
    expect(sql).toContain('v_session.restaurant_id, p_method, v_due_paise, \'recorded\',');
    expect(sql).toContain("'manual_marked_paid', p_method, v_due_paise");
  });

  it('stays locked down: security definer, fixed search path, no public execute', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toContain('revoke all on function public.mark_order_session_paid(uuid, text, text) from anon;');
    expect(sql).toContain('grant execute on function public.mark_order_session_paid(uuid, text, text) to authenticated;');
  });
});
