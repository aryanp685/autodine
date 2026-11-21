import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  supabase: null as unknown,
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/table-session', () => ({ readTableSession: () => Promise.resolve(mocks.session) }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => Promise.resolve(mocks.supabase) }));

import { callWaiterAction } from './waiter-actions';

const requestKey = 'a10f6ca2-6eaa-48b6-92f5-819f8437f122';
const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('callWaiterAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { token };
    mocks.supabase = { rpc: mocks.rpc };
    mocks.rpc.mockResolvedValue({ data: 'created', error: null });
  });

  it('rejects a malformed idempotency key before reading the session or database', async () => {
    await expect(callWaiterAction('bad')).resolves.toEqual({
      ok: false,
      error: 'We could not send that request. Please try again.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires a table session from the server cookie', async () => {
    mocks.session = null;
    await expect(callWaiterAction(requestKey)).resolves.toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends only the cookie token and idempotency key to the database', async () => {
    await expect(callWaiterAction(requestKey)).resolves.toEqual({ ok: true, state: 'created' });
    expect(mocks.rpc).toHaveBeenCalledWith('call_waiter', {
      p_session_token: token,
      p_request_key: requestKey,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/kitchen');
  });

  it.each(['already_open', 'already_handled'] as const)('treats %s as a successful idempotent result', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(callWaiterAction(requestKey)).resolves.toEqual({ ok: true, state: data });
  });

  it('explains the table cooldown without disclosing database details', async () => {
    mocks.rpc.mockResolvedValue({ data: 'wait_a_moment', error: null });
    await expect(callWaiterAction(requestKey)).resolves.toEqual({
      ok: false,
      error: 'Please wait a little before calling again.',
    });
  });

  it('passes guest-safe validation messages and hides unexpected SQL errors', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Your table session has expired.' } });
    await expect(callWaiterAction(requestKey)).resolves.toEqual({ ok: false, error: 'Your table session has expired.' });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'relation secret not found' } });
    await expect(callWaiterAction(requestKey)).resolves.toMatchObject({
      ok: false,
      error: 'We could not reach the restaurant. Please tell a staff member.',
    });
  });
});
