import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261108001000_order_code_and_kitchen_announce_guard.sql', import.meta.url),
  'utf8',
);
const sessionRestoreSql = readFileSync(
  new URL('../../supabase/migrations/20261108006000_restore_public_order_session_attach.sql', import.meta.url),
  'utf8',
);

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is missing from the migration`).toBeGreaterThan(-1);
  const open = source.indexOf('$$', start);
  const close = source.indexOf('$$;', open + 2);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return source.slice(start, close);
}

describe('small reliability migration', () => {
  it('preflights existing order codes and enforces restaurant-scoped uniqueness', () => {
    expect(sql).toContain('GROUP BY restaurant_id, code');
    expect(sql).toContain('HAVING count(*) > 1');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS orders_restaurant_code_unique');
    expect(sql).toContain('ON public.orders (restaurant_id, code)');
  });

  it('retries only order-code collisions, with a bounded attempt count', () => {
    const helper = functionBody(sql, 'place_public_order_core_with_code_retry');
    expect(helper).toContain('public.place_public_order_core(');
    expect(helper).toContain("v_constraint_name IS DISTINCT FROM 'orders_restaurant_code_unique'");
    expect(helper).toContain('IF v_attempt >= 8');
    expect(helper).toContain('GET STACKED DIAGNOSTICS');
    expect(sql).toContain('public.place_public_order_core_with_code_retry(p_slug, p_lines, p_note, p_session_token)');
  });

  it('retains the existing public-order guards and idempotency behavior', () => {
    const wrapper = functionBody(sql, 'place_public_order');
    expect(wrapper).toContain('public.hit_rate_limit(');
    expect(wrapper).toContain('public.stamp_guest_verification(');
    expect(wrapper).toContain('p_guest_token');
    expect(wrapper).toContain('tax_rate_bps_snapshot');
    expect(wrapper).toContain('WHEN unique_violation');
    expect(sql).toContain('TO anon');
    expect(sql).toContain('TO authenticated');
  });

  it('preserves the table-session attachment in the latest order wrapper', () => {
    const wrapper = functionBody(sessionRestoreSql, 'place_public_order');
    expect(wrapper).toContain('INSERT INTO public.order_sessions (restaurant_id, table_id)');
    expect(wrapper).toContain("ON CONFLICT (table_id) WHERE status = 'open'");
    expect(wrapper).toContain('SET order_session_id = v_order_session_id');
    expect(wrapper).toContain('WHEN unique_violation');
    expect(sessionRestoreSql).toContain('place_public_order_core_with_code_retry');
  });

  it('allows one authenticated kitchen member on one device to claim each live ticket', () => {
    const claim = functionBody(sql, 'claim_kitchen_order_announcement');
    expect(sql).toContain('order_id uuid PRIMARY KEY REFERENCES public.orders(id)');
    expect(sql).toContain('ALTER TABLE public.kitchen_announcement_claims ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON public.kitchen_announcement_claims FROM authenticated');
    expect(claim).toContain('auth.uid()');
    expect(claim).toContain("o.prep_status = 'new'");
    expect(claim).toContain('NOT (o.hold_required AND o.confirmed_at IS NULL)');
    expect(claim).toContain("m.role IN ('owner', 'manager', 'kitchen')");
    expect(claim).toContain('ON CONFLICT (order_id) DO NOTHING');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_kitchen_order_announcement(uuid) TO authenticated');
    expect(sql).not.toContain('GRANT SELECT ON public.kitchen_announcement_claims');
  });
});
