import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261115000100_fix_redeem_staff_invite_status_returns.sql', import.meta.url),
  'utf8',
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing from the corrective migration`).toBeGreaterThan(-1);
  const open = sql.indexOf('as $$', start);
  const close = sql.indexOf('$$;', open + 5);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(start, close);
}

describe('redeem_staff_invite corrective migration', () => {
  it('stops the function after each non-ok single-use status branch', () => {
    const body = functionBody('redeem_staff_invite');
    for (const status of ['closed', 'revoked', 'used', 'expired']) {
      const marker = `return query select '${status}'`;
      const at = body.indexOf(marker);
      expect(at, `${status} branch is missing`).toBeGreaterThan(-1);
      const following = body.slice(at, body.indexOf('\n', at) + 1);
      const next = body.slice(body.indexOf('\n', at) + 1, body.indexOf('\n', body.indexOf('\n', at) + 1) + 1);
      expect(`${following}${next}`.trim().split('\n').at(-1)?.trim(), `${status} must return before the membership write path`).toBe('return;');
    }
  });

  it('preserves the idempotent already_member replay and the grants', () => {
    const body = functionBody('redeem_staff_invite');
    expect(body).toContain('v_invite.redeemed_by = v_actor');
    expect(body).toContain('public.hit_rate_limit(');
    expect(sql).toMatch(/revoke all on function public\.redeem_staff_invite\(text\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.redeem_staff_invite\(text\) to authenticated;/);
  });
});
