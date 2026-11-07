import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { consumeInviteAttemptBudget } from './team-invite-attempt-budget';

describe('staff invite attempt budget', () => {
  it('uses only fingerprints for IP and invite code keys', async () => {
    const hit = vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    await expect(consumeInviteAttemptBudget('signup', 'K7QM-3XPD-9RTW-2HNJ', 'ip-fingerprint', hit)).resolves.toEqual({
      allowed: true,
    });

    const keys = hit.mock.calls.map(([key]) => key);
    const expectedCodeHash = createHash('sha256').update('K7QM3XPD9RTW2HNJ').digest('hex');
    expect(keys).toEqual([
      'staff-invite:signup:ip:ip-fingerprint',
      `staff-invite:signup:ip_code:ip-fingerprint:${expectedCodeHash}`,
    ]);
    expect(keys.join(' ')).not.toContain('K7QM');
  });

  it('stops at the first exhausted budget and reports a bounded retry time', async () => {
    const hit = vi
      .fn()
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 10_000_000 });

    await expect(consumeInviteAttemptBudget('accept', 'K7QM3XPD9RTW2HNJ', 'ip-fingerprint', hit)).resolves.toEqual({
      allowed: false,
      reason: 'limited',
      retryAfterSeconds: 86_400,
    });
    expect(hit).toHaveBeenCalledTimes(2);
  });

  it('fails closed if the shared rate-limit service cannot answer', async () => {
    const hit = vi.fn().mockResolvedValue(null);

    await expect(consumeInviteAttemptBudget('signup', 'K7QM3XPD9RTW2HNJ', 'ip-fingerprint', hit)).resolves.toEqual({
      allowed: false,
      reason: 'unavailable',
      retryAfterSeconds: null,
    });
  });

  it('fails closed if the rate-limit service throws', async () => {
    const hit = vi.fn().mockRejectedValue(new Error('database detail should not escape'));

    await expect(consumeInviteAttemptBudget('accept', 'K7QM3XPD9RTW2HNJ', 'ip-fingerprint', hit)).resolves.toEqual({
      allowed: false,
      reason: 'unavailable',
      retryAfterSeconds: null,
    });
  });
});
