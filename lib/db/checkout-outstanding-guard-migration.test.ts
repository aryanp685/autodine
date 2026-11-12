import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261110000800_checkout_outstanding_guard.sql', import.meta.url),
  'utf8',
);
const start = sql.indexOf('create or replace function public.close_order_session_and_issue_receipt(');
const open = sql.indexOf('$$', start);
const close = sql.indexOf('$$;', open + 2);
const checkout = sql.slice(start, close);

describe('forward-only checkout outstanding-balance guard', () => {
  it('locks the session before deriving balances from recorded, tenant-matched payments', () => {
    expect(checkout).toContain('from public.order_sessions s');
    expect(checkout).toContain('for update');
    expect(checkout).toContain('pay.restaurant_id = v_session.restaurant_id');
    expect(checkout).toContain("pay.status = 'recorded'");
    expect(checkout).toContain("o.prep_status <> 'cancelled'");
    expect(checkout).toContain('v_outstanding_paise > 0');
    expect(checkout).toContain('public.restaurant_can_write(v_session.restaurant_id)');
  });

  it('guards both first checkout and a closed session without an issued invoice', () => {
    expect(checkout).toContain("if v_session.status = 'open' then");
    expect(checkout).toContain('Collect the full outstanding balance before closing this table session.');
    expect(checkout).toContain('elsif not exists (');
    expect(checkout).toContain('Collect the full outstanding balance before issuing this session receipt.');
    expect(checkout).toContain('public.issue_closed_session_receipt(v_session.id)');
  });

  it('keeps the authenticated RPC contract and makes no data or history rewrite', () => {
    expect(sql).toContain('revoke all on function public.close_order_session_and_issue_receipt(uuid) from public, anon, authenticated');
    expect(sql).toContain('grant execute on function public.close_order_session_and_issue_receipt(uuid) to authenticated');
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate)\s+public\.(orders|payments|restaurant_invoices)\b/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|function)\b/i);
    expect(sql).toContain('create or replace function');
  });
});
