import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261108005000_p9_security_hardening.sql', import.meta.url),
  'utf8',
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing from the migration`).toBeGreaterThan(-1);
  const open = sql.indexOf('as $$', start);
  const close = sql.indexOf('$$;', open + 5);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(start, close);
}

describe('P9 security hardening migration', () => {
  it('budgets signed-in preview and redemption attempts inside the guarded RPCs', () => {
    const preview = functionBody('preview_staff_invite');
    const redeem = functionBody('redeem_staff_invite');
    for (const body of [preview, redeem]) {
      expect(body).toContain('public.hit_rate_limit(');
      expect(body).toContain("'staff-invite:");
      expect(body).toContain('v_actor::text');
      expect(body).toContain('v_code_hash');
      expect(body).toContain("'rate_limited'");
    }
  });

  it('makes a committed redemption safe to retry for the same member only', () => {
    const redeem = functionBody('redeem_staff_invite');
    const replay = redeem.indexOf("v_invite.redeemed_by = v_actor");
    const used = redeem.indexOf("return query select 'used'");
    expect(replay).toBeGreaterThan(-1);
    expect(used).toBeGreaterThan(replay);
    expect(redeem.slice(replay, used)).toContain('public.memberships');
    expect(redeem.slice(replay, used)).toContain("'already_member'");
  });

  it('records invite and team membership changes in an append-only log without code hashes', () => {
    expect(sql).toContain('public.staff_security_audit_log');
    expect(sql).toContain('staff_security_audit_log_immutable');
    expect(sql).toContain('restaurant_invites_security_audit');
    expect(sql).toContain('memberships_security_audit');
    expect(sql).toContain('public.list_staff_security_audit');
    expect(sql).toContain("'staff_invite.created'");
    expect(sql).toContain("'staff_invite.redeemed'");
    expect(sql).toContain("'staff_invite.revoked'");
    expect(sql).toContain("'staff_member.removed'");
    expect(sql).not.toMatch(/metadata[^;]*code_hash/is);
    expect(sql).toContain('revoke all on public.staff_security_audit_log from public, anon, authenticated, service_role');
    expect(sql).toContain('grant execute on function public.list_staff_security_audit(uuid, integer) to authenticated');
  });
});
