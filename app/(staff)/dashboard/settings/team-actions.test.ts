import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three writes behind Settings → People.
 *
 * The thread running through these tests is that a refusal must stay a
 * refusal: the role checks happen before the RPC is called, a failed write
 * never redirects to a success notice, and the invitation code -- the one
 * secret in this flow -- never appears in a URL.
 */

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
  rpc: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
  cookieSet: vi.fn(),
  sendEmail: vi.fn(async () => ({ outcome: 'not_configured', provider: 'none', attempts: 0 })),
}));

vi.mock('next/navigation', () => ({
  // Next's redirect throws to unwind the render; the same trick keeps these
  // tests free of a real router.
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`redirect:${url}`);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => mocks.revalidate(path) }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: mocks.cookieSet, get: () => undefined }),
  headers: async () => new Headers({ host: 'app.test', 'x-forwarded-proto': 'https' }),
}));

vi.mock('@/lib/site-origin', () => ({
  requestOrigin: async () => 'https://app.test',
}));

vi.mock('@/lib/email/provider', () => ({
  isValidRecipient: (value: unknown) =>
    typeof value === 'string' && /^[^\s@<>]{1,64}@[^\s@<>]{1,253}\.[^\s@<>]{2,}$/.test(value.trim()),
  sendEmail: (kind: unknown, message: unknown) =>
    (mocks.sendEmail as (...args: unknown[]) => unknown)(kind, message),
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));

import { createInviteAction, removeMemberAction, revokeInviteAction } from './team-actions';

function signedIn(role = 'owner') {
  return {
    ok: true as const,
    context: {
      role,
      restaurantId: 'r-1',
      restaurantName: 'Maddi',
      supabase: { rpc: mocks.rpc },
    },
  };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function urlOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('redirect:')) return message.slice('redirect:'.length);
    throw error;
  }
  throw new Error('the action returned instead of redirecting');
}

beforeEach(() => {
  mocks.staff.result = signedIn();
  mocks.rpc.mockReset();
  mocks.redirect.mockReset();
  mocks.revalidate.mockReset();
  mocks.cookieSet.mockReset();
  mocks.sendEmail.mockReset();
  mocks.sendEmail.mockResolvedValue({ outcome: 'not_configured', provider: 'none', attempts: 0 });
});

describe('creating an invitation', () => {
  it('refuses a role that is not one of the three', async () => {
    const url = await urlOf(() => createInviteAction(form({ role: 'owner', days: '7' })));
    expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/which role/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a lifetime nobody offered', async () => {
    const url = await urlOf(() => createInviteAction(form({ role: 'cashier', days: '365' })));
    expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/between 1 and 30/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not let a manager create a manager', async () => {
    mocks.staff.result = signedIn('manager');
    const url = await urlOf(() => createInviteAction(form({ role: 'manager', days: '7' })));
    expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/only the owner/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not let a kitchen or cashier login invite anybody', async () => {
    for (const role of ['kitchen', 'cashier']) {
      mocks.staff.result = signedIn(role);
      const url = await urlOf(() => createInviteAction(form({ role: 'kitchen', days: '7' })));
      expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/owner or a manager/i);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('carries the new code in an httpOnly cookie and never in the URL', async () => {
    mocks.rpc.mockResolvedValue({ data: 'K7QM-3XPD-9RTW-2HNJ', error: null });

    const url = await urlOf(() => createInviteAction(form({ role: 'kitchen', days: '7' })));
    const parsed = new URL(url, 'https://x.test');

    expect(mocks.rpc).toHaveBeenCalledWith('create_staff_invite', {
      p_restaurant_id: 'r-1',
      p_role: 'kitchen',
      p_days: 7,
    });

    // The code is the secret. A redirect is a log line, a history entry and a
    // Referer; this is the assertion that keeps it out of all three.
    expect(url).not.toContain('K7QM');
    expect(parsed.searchParams.get('notice')).toMatch(/invitation ready/i);

    const [name, value, options] = mocks.cookieSet.mock.calls[0];
    expect(name).toBe('ad_team_invite');
    expect(value).toContain('K7QM');
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/dashboard/settings' });
    expect(options.maxAge).toBeLessThanOrEqual(600);
  });

  it('refuses an address that is not an address, before anything is created', async () => {
    const url = await urlOf(() =>
      createInviteAction(form({ role: 'kitchen', days: '7', email: 'not-an-address' })),
    );
    expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/does not look right/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('sends the link to the address when email is given, and says so only when it was sent', async () => {
    mocks.rpc.mockResolvedValue({ data: 'K7QM-3XPD-9RTW-2HNJ', error: null });
    mocks.sendEmail.mockResolvedValue({ outcome: 'delivered', provider: 'resend', attempts: 1 });

    const url = await urlOf(() =>
      createInviteAction(form({ role: 'kitchen', days: '7', email: 'cook@example.com' })),
    );
    const notice = new URL(url, 'https://x.test').searchParams.get('notice') ?? '';
    expect(notice).toMatch(/emailed/i);
    expect(notice).not.toContain('cook@example.com');
    const [kind, message] = mocks.sendEmail.mock.calls[0] as unknown as [string, { to: string; text: string }];
    expect(kind).toBe('staff_invitation');
    expect(message.to).toBe('cook@example.com');
    expect(message.text).toContain('https://app.test/join/K7QM-3XPD-9RTW-2HNJ');
  });

  it('keeps the copy-link flow honest when email is not connected', async () => {
    mocks.rpc.mockResolvedValue({ data: 'K7QM-3XPD-9RTW-2HNJ', error: null });
    const url = await urlOf(() =>
      createInviteAction(form({ role: 'kitchen', days: '7', email: 'cook@example.com' })),
    );
    expect(new URL(url, 'https://x.test').searchParams.get('notice')).toMatch(/email is not connected/i);
  });

  it('says the send failed rather than implying the mail arrived', async () => {
    mocks.rpc.mockResolvedValue({ data: 'K7QM-3XPD-9RTW-2HNJ', error: null });
    mocks.sendEmail.mockResolvedValue({ outcome: 'failed', provider: 'resend', attempts: 3 });
    const url = await urlOf(() =>
      createInviteAction(form({ role: 'kitchen', days: '7', email: 'cook@example.com' })),
    );
    expect(new URL(url, 'https://x.test').searchParams.get('notice')).toMatch(/failed to send/i);
  });

  it('reports the database refusal verbatim instead of claiming success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Only the owner can invite a manager.' } });

    const url = await urlOf(() => createInviteAction(form({ role: 'manager', days: '7' })));
    const parsed = new URL(url, 'https://x.test');

    expect(parsed.searchParams.get('error')).toBe('Only the owner can invite a manager.');
    expect(parsed.searchParams.get('notice')).toBeNull();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});

describe('revoking an invitation', () => {
  it('says when the link was already used', async () => {
    mocks.rpc.mockResolvedValue({ data: 'used', error: null });
    const url = await urlOf(() => revokeInviteAction(form({ inviteId: 'i-1' })));
    expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/already been used/i);
  });

  it('confirms only when the database says revoked', async () => {
    mocks.rpc.mockResolvedValue({ data: 'revoked', error: null });
    const url = await urlOf(() => revokeInviteAction(form({ inviteId: 'i-1' })));
    expect(new URL(url, 'https://x.test').searchParams.get('notice')).toMatch(/cancelled/i);
  });

  it('does not report a revoke for a status it does not recognise', async () => {
    mocks.rpc.mockResolvedValue({ data: 'something-else', error: null });
    const url = await urlOf(() => revokeInviteAction(form({ inviteId: 'i-1' })));
    expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/could not revoke/i);
  });
});

describe('removing somebody', () => {
  it('is owner-only, before the database is asked', async () => {
    mocks.staff.result = signedIn('manager');
    const url = await urlOf(() => removeMemberAction(form({ membershipId: 'm-2' })));
    expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/only the owner/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('passes the last-owner refusal through in the database’s own words', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'The last owner cannot be removed. Make somebody else an owner first.' },
    });

    const url = await urlOf(() => removeMemberAction(form({ membershipId: 'm-1' })));
    expect(new URL(url, 'https://x.test').searchParams.get('error')).toMatch(/last owner cannot be removed/i);
  });

  it('confirms a removal that actually happened', async () => {
    mocks.rpc.mockResolvedValue({ data: 'removed', error: null });
    const url = await urlOf(() => removeMemberAction(form({ membershipId: 'm-2' })));
    expect(new URL(url, 'https://x.test').searchParams.get('notice')).toMatch(/access removed/i);
    expect(mocks.revalidate).toHaveBeenCalledWith('/dashboard/settings');
  });
});
