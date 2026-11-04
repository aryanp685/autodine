import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The veg tri-state migration's properties, pinned.
 *
 * Same idea as lib/branding/migration-guards.test.ts: `npm run sql:check`
 * only proves the DDL parses, so the properties that matter live here as
 * string assertions a reviewer should not have to re-find:
 *
 *   - the columns widen to nullable and the silent veg DEFAULT is dropped;
 *   - place_public_order_core keeps its security definer posture, pinned
 *     search_path and the restaurant_can_write gate -- the recreation is
 *     supposed to be byte-identical except for the two is_veg lines, and
 *     these pins are how we notice if it is not;
 *   - the order snapshot passes is_veg through untouched (no coalesce-to-veg);
 *   - price truth still comes from the tables, never from the request.
 *
 * String assertions on SQL. The real behaviour still needs one run against a
 * throwaway database before this migration ships.
 */

const sql = readFileSync(
  new URL('../../supabase/migrations/20261105000100_veg_tri_state.sql', import.meta.url),
  'utf8',
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing from the migration`).toBeGreaterThan(-1);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  expect(open, `${name} has no plpgsql body`).toBeGreaterThan(-1);
  expect(close, `${name} body is not terminated`).toBeGreaterThan(open);
  return sql.slice(start, close);
}

describe('veg tri-state migration guards', () => {
  it('widens both columns and drops the silent veg default', () => {
    expect(sql).toContain('alter table public.items alter column is_veg drop not null;');
    expect(sql).toContain('alter table public.items alter column is_veg drop default;');
    expect(sql).toContain('alter table public.order_items alter column is_veg drop not null;');
    expect(sql).toContain('alter table public.order_items alter column is_veg drop default;');
  });

  describe('place_public_order_core', () => {
    const body = functionBody('place_public_order_core');

    it('is security definer with a pinned search_path', () => {
      expect(body).toContain('security definer');
      expect(body).toContain("set search_path to 'public', 'pg_temp'");
    });

    it('keeps the trial write gate inside the function', () => {
      expect(body).toContain('public.restaurant_can_write(');
    });

    it('keeps price truth server-side', () => {
      expect(body).toContain('coalesce(v.price_paise, i.price_paise)');
    });

    it('snapshots is_veg through, uncoerced', () => {
      expect(body).toContain('is_veg boolean,');
      expect(body).not.toContain('is_veg boolean not null');
      expect(body).not.toContain('coalesce(i.is_veg');
      expect(body).toContain('i.is_veg,');
    });

    it('revokes every grant from public and anon', () => {
      expect(sql).toContain(
        'revoke all on function public.place_public_order_core(text, jsonb, text, text) from public;',
      );
      expect(sql).toContain(
        'revoke all on function public.place_public_order_core(text, jsonb, text, text) from anon;',
      );
      expect(sql).toContain(
        'revoke all on function public.place_public_order_core(text, jsonb, text, text) from authenticated;',
      );
    });
  });
});
