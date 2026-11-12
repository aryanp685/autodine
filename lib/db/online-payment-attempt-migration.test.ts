import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261110000900_online_payment_attempt_uniqueness.sql', import.meta.url),
  'utf8',
);
function body(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  expect(close).toBeGreaterThan(open);
  return sql.slice(start, close);
}

describe('serialized one-intent-per-order online-payment migration', () => {
  const begin = body('begin_online_payment');
  const settle = body('settle_online_payment');

  it('keeps security-definer call surfaces pinned and relies on the existing service-only grants', () => {
    for (const fn of [begin, settle]) {
      expect(fn).toContain('security definer');
      expect(fn).toContain('set search_path = public, pg_temp');
    }
    const lowerSql=sql.toLowerCase();
    for(const name of ['begin_online_payment','settle_online_payment']) {
      expect(lowerSql).not.toContain(`grant execute on function public.${name}`);
      expect(lowerSql).not.toContain(`revoke all on function public.${name}`);
    }
  });

  it('keeps same-provider retries idempotent while refusing a second pending intent', () => {
    expect(begin).toContain("'online-intent:' || p_provider || ':' || p_provider_order_ref");
    expect(begin).toContain('where p.idempotency_key=v_key for update');
    expect(begin).toContain("p.method='online' and p.status='pending'");
    expect(begin).toContain('An online payment is already in progress for this order.');
    expect(begin.indexOf('where p.idempotency_key=v_key'))
      .toBeLessThan(begin.indexOf("p.method='online' and p.status='pending'"));
  });

  it('uses the financial session→order→payment lock order for both RPCs', () => {
    for (const fn of [begin, settle]) {
      expect(fn).toContain('for update of s');
      expect(fn).toContain('for update of o');
    }
    expect(settle.indexOf('for update of s')).toBeLessThan(settle.indexOf('for update of o'));
    expect(settle.indexOf('for update of o')).toBeLessThan(settle.indexOf('for update;'));
  });

  it('settles only the still-current full balance and leaves stale attempts pending', () => {
    expect(settle).toContain("v_order.payment_status <> 'pending'");
    expect(settle).toContain("v_order.prep_status='cancelled'");
    expect(settle).toContain("p.status='recorded'");
    expect(settle).toContain('v_row.amount_paise <> v_due_paise');
    expect(settle).toContain("set status='recorded',provider_payment_ref=p_provider_payment_ref");
    expect(settle).toContain("'online_collected','online',v_row.amount_paise");
  });
});
