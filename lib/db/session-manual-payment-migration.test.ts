import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261107082936_session_manual_payment_p4.sql', import.meta.url),
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

describe('P4 session manual-payment migration guards', () => {
  const body = functionBody('mark_order_session_paid');

  it('adds only a hidden manual ledger method while retaining existing methods', () => {
    expect(sql.match(/check \(method in \('cash', 'card', 'upi', 'online', 'manual'\)\)/g)).toHaveLength(2);
    expect(sql).toContain("check (event_type in ('cash_collected', 'card_collected', 'upi_collected', 'online_collected', 'manual_marked_paid'))");
    expect(sql).not.toContain('p_method');
    expect(sql).toContain("'staff_manual'");
  });

  it('stores paid timestamp and staff on the table session', () => {
    expect(sql).toContain('add column if not exists paid_at timestamptz');
    expect(sql).toContain('add column if not exists paid_by uuid');
    expect(body).toContain('set paid_at = v_settled_at');
    expect(body).toContain('paid_by = v_actor_id');
  });

  it('derives every amount server-side and records payments plus audit events atomically', () => {
    expect(body).toContain('select s.* into v_session');
    expect(body).toContain('for update of s');
    expect(body).toContain('for update');
    expect(body).toContain("p.status = 'recorded'");
    expect(body).toContain('greatest(v_order.total_paise - v_paid_paise, 0)');
    expect(body).toContain("'manual', v_due_paise, 'recorded'");
    expect(body).toContain("'manual_marked_paid', 'manual', v_due_paise");
    expect(body).toContain('set payment_status = \'paid\'');
  });

  it('keeps authentication, role checks, trial write gate and closed-session refusal', () => {
    expect(body).toContain('auth.uid()');
    expect(body).toContain("v_role not in ('owner', 'manager', 'cashier')");
    expect(body).toContain('public.restaurant_can_write(v_session.restaurant_id)');
    expect(body).toContain("v_session.status <> 'open'");
    expect(body).toContain('v_session.closed_at is not null');
    expect(body).toContain("o.prep_status <> 'cancelled'");
  });

  it('is idempotent per session-ticket and grants execute only to signed-in callers', () => {
    expect(body).toContain("'manual-session:' || v_session.id::text || ':' || v_order.id::text");
    expect(body).toContain('p.idempotency_key = v_key');
    expect(sql).toContain('revoke all on function public.mark_order_session_paid(uuid) from public');
    expect(sql).toContain('revoke all on function public.mark_order_session_paid(uuid) from anon');
    expect(sql).toContain('grant execute on function public.mark_order_session_paid(uuid) to authenticated');
  });
});
