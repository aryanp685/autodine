import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261108010000_invoice_share_links.sql', import.meta.url),
  'utf8',
);
const p8Check = readFileSync(new URL('../../supabase/checks/07_p8_close_settlement.sql', import.meta.url), 'utf8');

function body(name: string) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const open = sql.indexOf('as $$', start);
  const close = sql.indexOf('$$;', open + 5);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(start, close);
}

describe('secure receipt-sharing migration', () => {
  it('stores only a hash and denies direct access to link and audit rows', () => {
    expect(sql).toContain('token_hash text not null unique');
    expect(sql).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain('alter table public.restaurant_invoice_share_links enable row level security');
    expect(sql).toContain('revoke all on public.restaurant_invoice_share_links from public, anon, authenticated, service_role');
    expect(sql).toContain('revoke all on public.restaurant_invoice_share_audit from public, anon, authenticated, service_role');
    expect(sql).not.toMatch(/token_hash[^,]*raw token/i);
  });

  it('creates links only for an issued same-tenant invoice and finance roles, with a hard 24-hour expiry', () => {
    const create = body('create_restaurant_invoice_share_link');
    expect(create).toContain("v_role not in ('owner', 'manager', 'cashier')");
    expect(create).toContain('v_invoice.status <> \'issued\'');
    expect(create).toContain('public.restaurant_can_write(v_invoice.restaurant_id)');
    expect(create).toContain("statement_timestamp() + interval '24 hours'");
    expect(create).toContain('restaurant_invoice_share_audit');
  });

  it('resolves by opaque hash only and fails closed on rate limit, expiry, revoke or void', () => {
    const read = body('read_shared_restaurant_invoice');
    expect(read).toContain('p_token_hash');
    expect(read).toContain('public.hit_rate_limit');
    expect(read).toContain('l.revoked_at is null');
    expect(read).toContain('l.expires_at > statement_timestamp()');
    expect(read).toContain("i.status = 'issued'");
    expect(read).toContain("'lines', v_lines");
    expect(read).not.toContain('p_invoice_id');
    expect(read).not.toContain('p_restaurant_id');
  });

  it('supports finance-role revocation and records staff/public access events', () => {
    expect(body('revoke_restaurant_invoice_share_link')).toContain("v_actor, 'revoked'");
    expect(body('list_restaurant_invoice_share_links')).toContain("v_role not in ('owner', 'manager', 'cashier')");
    expect(sql).toContain("event_type in ('created', 'revoked', 'opened')");
    expect(p8Check).toContain('a revoked receipt link still resolves');
    expect(p8Check).toContain('an expired receipt link still resolves');
    expect(p8Check).toContain('non-member created a receipt share link');
  });
});
