import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The Brand Studio migration's security properties, pinned.
 *
 * `npm run sql:check` proves the DDL parses; it strips function bodies and
 * policies and validates nothing about them. These tests read the same file
 * and assert the properties a reviewer should not have to re-find every time:
 *
 *   - the SECURITY DEFINER functions carry their own auth, role AND trial
 *     gates (a definer function that forgets `restaurant_can_write` becomes a
 *     way around the menus_manage RLS policy);
 *   - guests can reach no write path;
 *   - tenant isolation is enforced twice (path CHECKs and composite FKs);
 *   - Brand Studio is opt-in: the enabled flag defaults to false.
 *
 * They are string assertions on SQL — the real behaviour still needs one run
 * against a throwaway database before this migration ships.
 */

const sql = readFileSync(
  new URL('../../supabase/migrations/20261103000100_brand_studio.sql', import.meta.url),
  'utf8',
);

/** The body of one `create or replace function public.<name>(...) ... $$ ... $$;` */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing from the migration`).toBeGreaterThan(-1);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  expect(open, `${name} has no plpgsql body`).toBeGreaterThan(-1);
  expect(close, `${name} body is not terminated`).toBeGreaterThan(open);
  return sql.slice(start, close);
}

describe('brand studio migration guards', () => {
  for (const fn of ['publish_menu_brand_pair', 'rollback_last_publish']) {
    describe(fn, () => {
      const body = functionBody(fn);

      it('is security definer with a pinned search_path', () => {
        expect(body).toContain('security definer');
        expect(body).toMatch(/set search_path to 'public'/);
      });

      it('refuses unauthenticated callers', () => {
        expect(body).toContain('auth.uid()');
        expect(body).toMatch(/if v_user is null then\s+raise exception 'unauthenticated'/);
      });

      it('enforces owner/manager AND the trial write gate internally', () => {
        // has_restaurant_role alone is not enough: menus writes are
        // trial-gated by menus_manage (20261029000100), and this function
        // writes menus.is_published behind RLS's back.
        expect(body).toContain('has_restaurant_role');
        expect(body).toContain('restaurant_can_write');
      });

      it('revokes every grant from public and anon', () => {
        const revokeBlock = sql.slice(sql.indexOf(`revoke all on function public.${fn}`));
        expect(revokeBlock).toContain(`revoke all on function public.${fn}`);
        expect(revokeBlock.slice(0, 800)).toMatch(/from public/);
        expect(revokeBlock.slice(0, 800)).toMatch(/from anon/);
        expect(revokeBlock.slice(0, 800)).toContain(`grant execute on function public.${fn}`);
        expect(revokeBlock.slice(0, 800)).toMatch(/grant execute on function public\.\w+\([^)]*\) to authenticated/);
      });
    });
  }

  it('brand studio is opt-in: the theme flag defaults to false', () => {
    expect(sql).toMatch(/brand_theme_enabled boolean not null default false/);
  });

  it('enforces tenant isolation twice: path CHECKs and composite FKs', () => {
    // Path CHECK: a row can never point at another tenant's folder.
    expect(sql).toMatch(/check \(path like restaurant_id::text \|\| '\/%'\)/);
    // Composite FKs: a profile can never reference another restaurant's asset.
    expect(sql).toContain('foreign key (logo_asset_id, restaurant_id)');
    expect(sql).toContain('foreign key (banner_asset_id, restaurant_id)');
  });

  it('keeps owner working material in a private bucket', () => {
    const bucket = sql.slice(sql.indexOf("'restaurant-brand-source'"), sql.indexOf("'restaurant-brand-source'") + 200);
    // The values tuple is (id, name, public, size, mimes): third is `false`.
    expect(bucket).toMatch(/'restaurant-brand-source',\s*'restaurant-brand-source',\s*false/);
  });

  it('writes history before it can be rolled back', () => {
    const publish = functionBody('publish_menu_brand_pair');
    expect(publish).toContain('insert into public.restaurant_publish_history');
    expect(publish).toContain("'publish'");
    const rollback = functionBody('rollback_last_publish');
    expect(rollback).toContain('insert into public.restaurant_publish_history');
    expect(rollback).toContain("'rollback'");
  });
});
