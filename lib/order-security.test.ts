import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/20261019000003_trial_entitlements.sql', import.meta.url),
  'utf8',
);

const placeOrder = migration.match(
  /create or replace function public\.place_order\([\s\S]*?\n\$\$;/i,
)?.[0];

describe('order creation security migration', () => {
  it('drops authenticated direct order and order-item insert policies without replacing them', () => {
    expect(migration).toMatch(/drop policy if exists orders_staff_insert on public\.orders;/i);
    expect(migration).toMatch(/drop policy if exists order_items_insert on public\.order_items;/i);
    expect(migration).toMatch(/revoke insert on table public\.orders from public, anon, authenticated;/i);
    expect(migration).toMatch(/revoke insert on table public\.order_items from public, anon, authenticated;/i);
    expect(migration).not.toMatch(/create policy orders_staff_insert\b/i);
    expect(migration).not.toMatch(/create policy order_items_insert\b/i);
  });

  it('keeps order creation behind the database function and server-side trial gate', () => {
    expect(placeOrder).toBeDefined();
    expect(placeOrder).toMatch(/security definer/i);
    expect(placeOrder).toContain('public.restaurant_can_write(v_restaurant.id)');
    expect(placeOrder).toContain('i.restaurant_id = v_restaurant.id');
    expect(placeOrder).toContain('and i.is_available');
    expect(placeOrder).toContain('if v_qty is null or v_qty <= 0 then');
    expect(placeOrder).toContain('v_subtotal := v_subtotal + (v_unit * v_qty::bigint)');
    expect(placeOrder).toContain("'new', 'pending'");
    expect(placeOrder).not.toMatch(/p_(?:restaurant_id|total|subtotal|payment_status)\b/i);
  });
});
