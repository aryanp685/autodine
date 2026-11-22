import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ staff: vi.fn() }));
vi.mock('./staff', () => ({ getStaffContextDetailed: mocks.staff }));
vi.mock('@/lib/storage/assets', () => ({ publicAssetUrl: (path: string | null) => path }));
vi.mock('@/lib/qr', () => ({ siteOrigin: async () => 'https://example.test', qrSvg: async () => null }));

import { getBrandingScreenData } from './branding-screen';

function signedIn(failedRead = '') {
  const counts = new Map<string, number>();
  const from = vi.fn((table: string) => {
    const count = (counts.get(table) ?? 0) + 1;
    counts.set(table, count);
    const error = `${table}:${count}` === failedRead ? { message: 'database unavailable' } : null;
    const result = { data: error ? null : [], error, count: 0 };
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ ...result, data: null }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  });
  mocks.staff.mockResolvedValue({ ok: true, context: {
    supabase: { from }, restaurantId: 'r-1', role: 'owner', slug: 'test-outlet',
    restaurantName: 'Test outlet', outlets: [{ id: 'r-1' }],
  } });
  return from;
}

beforeEach(() => vi.clearAllMocks());

describe('branding screen reads', () => {
  it.each([
    'restaurants:1', 'menus:1', 'items:1', 'restaurant_publish_history:1',
    'categories:1', 'restaurant_brand_profiles:1', 'restaurants:2', 'menus:2',
  ])('does not turn a failed %s read into missing branding', async (read) => {
    signedIn(read);
    await expect(getBrandingScreenData()).rejects.toThrow(/database unavailable/);
  });

  it('preserves successful empty menu and draft states', async () => {
    signedIn();
    await expect(getBrandingScreenData()).resolves.toMatchObject({
      sampleDishes: [], hasPublishedMenu: false, hasDraft: false, storefronts: [],
    });
  });

  it('does not load branding without a session', async () => {
    mocks.staff.mockResolvedValue({ ok: false, reason: 'signed-out' });
    await expect(getBrandingScreenData()).resolves.toMatchObject({ blocked: 'signed-out', canEdit: false });
  });
});
