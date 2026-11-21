import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  readPublicRestaurant: vi.fn(),
}));

vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: true }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock('@/lib/db/public-restaurant', () => ({ readPublicRestaurant: mocks.readPublicRestaurant }));

import { getOrderScreenData } from './order-screen';

beforeEach(() => {
  mocks.createSupabaseServerClient.mockReset();
  mocks.readPublicRestaurant.mockReset();
});

describe('guest order-page credentials', () => {
  it('returns not found for a malformed token without creating a client or calling the UUID RPC', async () => {
    await expect(getOrderScreenData('restaurant', 'OR-12345', 'malformed-token')).resolves.toBeNull();

    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
    expect(mocks.readPublicRestaurant).not.toHaveBeenCalled();
  });
});
