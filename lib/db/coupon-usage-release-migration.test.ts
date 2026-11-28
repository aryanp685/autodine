import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261128150000_coupon_usage_release.sql', import.meta.url),
  'utf8',
);

describe('coupon usage release migration', () => {
  it('gives the use back on clear, on swap and on cancellation', () => {
    expect(sql).toContain('new.coupon_id is null or new.coupon_id is distinct from old.coupon_id');
    expect(sql).toContain("old.prep_status is distinct from 'cancelled' and new.prep_status = 'cancelled'");
  });

  it('never drives the counter below zero', () => {
    expect(sql).toContain('greatest(uses_count - 1, 0)');
  });

  it('fires after every update that can drop a coupon from a bill', () => {
    expect(sql).toMatch(/after update of coupon_id, prep_status on public\.orders/);
    expect(sql).toMatch(/for each row\s+execute function public\.release_coupon_use_on_order_change\(\)/);
  });

  it('runs as definer with a fixed search_path and no caller grants', () => {
    expect(sql).toMatch(/security definer\s+set search_path = public, pg_temp/);
    expect(sql).toContain('revoke all on function public.release_coupon_use_on_order_change() from public, anon, authenticated, service_role;');
  });
});
