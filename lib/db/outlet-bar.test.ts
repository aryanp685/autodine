import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The outlet switcher is a thin projection of the staff context, so the tests
 * cover the two behaviours it owns: an unusable session renders no switcher
 * (null, never an empty lie), and a usable one passes the outlet list and the
 * active outlet through untouched.
 */

const mocks = vi.hoisted(() => ({
  staff: { value: null as unknown },
}));

vi.mock('./staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.value),
}));

import { getOutletBar } from './outlet-bar';

beforeEach(() => {
  mocks.staff.value = null;
});

describe('getOutletBar', () => {
  it('returns null when there is no session, membership or database', async () => {
    for (const reason of ['unconfigured', 'signed-out', 'no-membership'] as const) {
      mocks.staff.value = { ok: false, reason };
      await expect(getOutletBar()).resolves.toBeNull();
    }
  });

  it('passes the outlet list, active outlet and operating path through', async () => {
    const outlets = [
      { id: 'r-1', name: 'Saffron & Smoke', role: 'owner' },
      { id: 'r-2', name: 'Second Kitchen', role: 'manager' },
    ];
    mocks.staff.value = {
      ok: true as const,
      context: {
        outlets,
        restaurantId: 'r-2',
        operatingMode: 'mode_b',
        posIntegrationName: 'eZee',
      },
    };

    await expect(getOutletBar()).resolves.toEqual({
      outlets,
      activeId: 'r-2',
      operatingMode: 'mode_b',
      posIntegrationName: 'eZee',
    });
  });
});
