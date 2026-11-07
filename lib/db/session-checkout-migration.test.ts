import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261108003000_session_checkout_payment_receipts.sql', import.meta.url),
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

describe('P8 checkout and supplemental payment receipt migration', () => {
  const checkout = functionBody('close_order_session_and_issue_receipt');
  const paymentTrigger = functionBody('issue_payment_receipt_after_invoice_payment');
  const timestampTrigger = functionBody('stamp_payment_recorded_at');

  it('closes the session and issues its invoice in one authenticated transaction', () => {
    expect(checkout).toContain('auth.uid()');
    expect(checkout).toContain("v_role not in ('owner', 'manager', 'cashier')");
    expect(checkout).toContain('for update');
    expect(checkout).toContain("v_session.status = 'open'");
    expect(checkout).toContain("set status = 'closed'");
    expect(checkout).toContain('public.issue_closed_session_receipt(v_session.id)');
    expect(sql).toContain('grant execute on function public.close_order_session_and_issue_receipt(uuid) to authenticated');
  });

  it('serializes payment arrival against checkout and never mutates an issued invoice', () => {
    expect(paymentTrigger).toContain('for update of s');
    expect(paymentTrigger).toContain('for update');
    expect(paymentTrigger).toContain("i.status = 'issued'");
    expect(paymentTrigger).toContain('new.order_id = any(i.source_order_ids)');
    expect(paymentTrigger).toContain('restaurant_payment_receipts');
    expect(paymentTrigger).toContain('on conflict (payment_id) do nothing');
    expect(paymentTrigger).not.toMatch(/update\s+public\.restaurant_invoices/i);
  });

  it('creates one separately numbered acknowledgement per payment, with the post-payment balance', () => {
    expect(sql).toContain('constraint restaurant_payment_receipts_one_per_payment unique (payment_id)');
    expect(sql).toContain('constraint restaurant_payment_receipts_invoice_sequence unique (invoice_id, sequence_number)');
    expect(paymentTrigger).toContain("'payment_amount_paise', new.amount_paise");
    expect(paymentTrigger).toContain("'total_paid_paise', v_paid");
    expect(paymentTrigger).toContain("'outstanding_paise', greatest(v_total - v_paid, 0)");
    expect(paymentTrigger).toContain("'payment_received_at', coalesce(new.recorded_at");
  });

  it('captures the actual received timestamp on both counter and asynchronous online settlement', () => {
    expect(sql).toContain('before insert or update of status, recorded_at on public.payments');
    expect(sql).toContain('after insert or update of status on public.payments');
    expect(timestampTrigger).toContain("new.status = 'recorded'");
    expect(timestampTrigger).toContain('statement_timestamp()');
  });

  it('keeps payment receipt reads tenant-scoped and denies direct writes', () => {
    expect(sql).toContain('alter table public.restaurant_payment_receipts enable row level security');
    expect(sql).toContain('using (public.is_member(restaurant_id))');
    expect(sql).toContain('revoke all on public.restaurant_payment_receipts from public, anon, authenticated, service_role');
    expect(sql).toContain('grant select on public.restaurant_payment_receipts to authenticated');
    expect(sql).toContain('revoke all on function public.issue_payment_receipt_after_invoice_payment() from public, anon, authenticated');
  });
});
