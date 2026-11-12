import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261110000900_converge_qr_verification_attempts.sql', import.meta.url),
  'utf8',
);

describe('state-preserving QR-attempt convergence migration', () => {
  it('recognizes the canonical pair key and preserves noncanonical source tables', () => {
    expect(sql).toContain("array['qr_code_id', 'ip_hash']::text[]");
    expect(sql).toContain("qr_verification_attempts_legacy_\' || v_suffix");
    expect(sql).toContain("alter table public.qr_verification_attempts rename to %I");
    expect(sql).toContain("c.relkind in ('r', 'p')");
    expect(sql).not.toMatch(/delete\s+from\s+public\.qr_verification_attempts_legacy/i);
  });

  it('imports only active event attempts, caps the counter, and retains the event archive', () => {
    expect(sql).toContain("a.attempted_at > $1 - interval '15 minutes'");
    expect(sql).toContain('least(5::bigint, count(*)::bigint)::integer');
    expect(sql).toContain('qr_verification_attempt_budgets');
    expect(sql).toContain('Unsupported legacy QR-attempt archive');
    expect(sql).toContain('Invalid identity or timestamp in legacy QR-attempt archive');
  });

  it('clears live state while preserving the source archive and re-arms expired blocks', () => {
    expect(sql).toContain('delete from public.qr_verification_attempts');
    expect(sql).toContain("when blocked_until is null or blocked_until <= v_now");
    expect(sql).toContain("then v_now + interval '15 minutes'");
    expect(sql).not.toMatch(/delete\s+from\s+public\.qr_verification_attempts_legacy/i);
  });
});
