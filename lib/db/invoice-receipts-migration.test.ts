import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261108002000_invoice_receipts.sql', import.meta.url),
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

describe('P6 receipt migration guards', () => {
  const issue = functionBody('issue_closed_session_receipt');
  const voidInvoice = functionBody('void_restaurant_invoice');

  it('uses a restaurant-specific, financial-year series with an atomic six-digit number', () => {
    expect(sql).toContain('primary key (restaurant_id, financial_year)');
    expect(sql).toContain("financial_year text not null check (financial_year ~ '^[0-9]{2}-[0-9]{2}$')");
    expect(issue).toContain("extract(month from v_local_date) < 4");
    expect(issue).toContain("'INV/' || v_fy || '/' || lpad(v_sequence::text, 6, '0')");
    expect(issue).toContain('for update');
    expect(issue).toContain('set next_number = v_sequence + 1');
    expect(sql).toContain('length(invoice_number) <= 16');
    expect(sql).toContain('restaurant_invoices_number_unique unique (restaurant_id, invoice_number)');
  });

  it('issues only from a closed session and retries return the existing issued invoice', () => {
    expect(issue).toContain("v_session.status <> 'closed'");
    expect(issue).toContain('v_session.closed_at is null');
    expect(issue).toContain("i.order_session_id = v_session.id and i.status = 'issued'");
    expect(issue).toContain('return v_existing.id');
    expect(sql).toContain('where status = \'issued\'');
  });

  it('builds the snapshot from every non-cancelled ticket and stored line values', () => {
    expect(issue).toContain('o.order_session_id = v_session.id');
    expect(issue).toContain("o.prep_status <> 'cancelled'");
    expect(issue).toContain('array_agg(o.id order by o.placed_at, o.id)');
    expect(issue).toContain("'ticket_code', o.code");
    expect(issue).toContain("'item_name', oi.name_snapshot");
    expect(issue).toContain("'unit_price_paise', oi.unit_price_paise");
    expect(issue).toContain('oi.unit_price_paise * oi.qty');
    expect(issue).toContain("p.status = 'recorded'");
    expect(issue).not.toContain('p_total');
    expect(issue).not.toContain('p_lines');
  });

  it('fails closed for missing restaurant identity and keeps GST invoices unavailable', () => {
    expect(issue).toContain("nullif(btrim(v_restaurant.name), '') is null");
    expect(issue).toContain("nullif(btrim(v_restaurant.address), '') is null");
    expect(issue).toContain("'receipt'");
    expect(issue).toContain('o.discount_paise > 0');
    expect(issue).toContain('approved item-level tax and discount audit configuration');
    expect(sql).toContain('GST tax invoices remain fail-closed');
    expect(sql).not.toContain('default 500');
  });

  it('keeps invoice snapshots readable but not directly writable, and tenant-scoped', () => {
    expect(sql).toContain('alter table public.restaurant_invoices enable row level security');
    expect(sql).toContain('using (public.is_member(restaurant_id))');
    expect(sql).toContain('revoke all on public.restaurant_invoices from public, anon, authenticated, service_role');
    expect(sql).toContain('grant select on public.restaurant_invoices, public.restaurant_invoice_lines to authenticated');
    expect(sql).toContain('grant execute on function public.issue_closed_session_receipt(uuid) to authenticated');
    expect(sql).toContain('grant execute on function public.void_restaurant_invoice(uuid, text) to authenticated');
  });

  it('voids only with owner/manager authorization and preserves the number for a replacement', () => {
    expect(voidInvoice).toContain("v_role not in ('owner', 'manager')");
    expect(voidInvoice).toContain('void_reason = btrim(p_reason)');
    expect(voidInvoice).toContain("v_invoice.status <> 'issued'");
    expect(sql).toContain('supersedes_invoice_id');
    expect(sql).toContain("i.status = 'voided'");
    expect(sql).not.toMatch(/delete\s+from\s+public\.restaurant_invoices/i);
  });
});
