import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffContext } from '@/lib/db/staff';
import type { ReportsScreenData } from '@/lib/db/reports';

const mocks = vi.hoisted(() => ({
  getStaffContextDetailed: vi.fn(),
  getReportsScreenDataForStaff: vi.fn(),
  summaryCsv: vi.fn(),
  ordersCsv: vi.fn(),
  itemsCsv: vi.fn(),
}));

vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: mocks.getStaffContextDetailed,
}));

vi.mock('@/lib/db/reports', () => ({
  getReportsScreenDataForStaff: mocks.getReportsScreenDataForStaff,
  summaryCsv: mocks.summaryCsv,
  ordersCsv: mocks.ordersCsv,
  itemsCsv: mocks.itemsCsv,
}));

vi.mock('@/lib/db/time', () => ({
  localDateKey: () => '2026-11-06',
}));

import { GET } from './route';

function context(role: StaffContext['role'], restaurantId = 'selected-restaurant'): StaffContext {
  return {
    supabase: { rpc: vi.fn() } as unknown as StaffContext['supabase'],
    restaurantId,
    restaurantName: 'Synthetic report outlet',
    timezone: 'UTC',
    tagline: null,
    slug: 'synthetic-report-outlet',
    role,
    outlets: [{ id: restaurantId, name: 'Synthetic report outlet', role }],
    access: null,
  };
}

function reportData(): ReportsScreenData {
  return {
    restaurantName: 'Synthetic report outlet',
    tagline: null,
    timezone: 'UTC',
    range: {
      key: 'today',
      fromIso: '2026-11-06T00:00:00.000Z',
      toIso: '2026-11-06T12:00:00.000Z',
      label: 'Today',
      bucket: 'hour',
      days: 1,
    },
    report: {} as ReportsScreenData['report'],
    ordersTruncated: false,
  };
}

function request(path: string): Request {
  return new Request(new URL(path, 'http://localhost').toString());
}

beforeEach(() => {
  mocks.getStaffContextDetailed.mockReset();
  mocks.getReportsScreenDataForStaff.mockReset().mockResolvedValue(reportData());
  mocks.summaryCsv.mockReset().mockReturnValue('summary csv');
  mocks.ordersCsv.mockReset().mockReturnValue('orders csv');
  mocks.itemsCsv.mockReset().mockReturnValue('items csv');
});

describe('GET /dashboard/reports/export authorization', () => {
  it('returns 401 for an unauthenticated caller before validating or querying a report', async () => {
    mocks.getStaffContextDetailed.mockResolvedValue({ ok: false, reason: 'signed-out' });

    const response = await GET(request('/dashboard/reports/export?type=invalid'));

    expect(response.status).toBe(401);
    expect(mocks.getReportsScreenDataForStaff).not.toHaveBeenCalled();
  });

  it('returns 403 for a signed-in caller without a staff membership', async () => {
    mocks.getStaffContextDetailed.mockResolvedValue({ ok: false, reason: 'no-membership' });

    const response = await GET(request('/dashboard/reports/export?type=orders'));

    expect(response.status).toBe(403);
    expect(mocks.getReportsScreenDataForStaff).not.toHaveBeenCalled();
  });

  it('returns 503 when the staff context is not configured', async () => {
    mocks.getStaffContextDetailed.mockResolvedValue({ ok: false, reason: 'unconfigured' });

    const response = await GET(request('/dashboard/reports/export?type=orders'));

    expect(response.status).toBe(503);
    expect(mocks.getReportsScreenDataForStaff).not.toHaveBeenCalled();
  });

  it.each(['cashier', 'kitchen'] as const)(
    'denies the %s role before running the report loader/RPC',
    async (role) => {
      mocks.getStaffContextDetailed.mockResolvedValue({ ok: true, context: context(role) });

      const response = await GET(request('/dashboard/reports/export?type=orders'));

      expect(response.status).toBe(403);
      expect(mocks.getReportsScreenDataForStaff).not.toHaveBeenCalled();
    },
  );

  it('returns 400 for an invalid export type after authorizing the caller', async () => {
    mocks.getStaffContextDetailed.mockResolvedValue({ ok: true, context: context('owner') });

    const response = await GET(request('/dashboard/reports/export?type=payroll'));

    expect(response.status).toBe(400);
    expect(mocks.getReportsScreenDataForStaff).not.toHaveBeenCalled();
  });

  it('exports orders for an Owner using the trusted selected outlet, ignoring a forged outlet parameter', async () => {
    const selected = context('owner', 'trusted-selected-outlet');
    mocks.getStaffContextDetailed.mockResolvedValue({ ok: true, context: selected });

    const response = await GET(
      request('/dashboard/reports/export?type=orders&range=7d&restaurant_id=attacker-outlet'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="autodine-orders-2026-11-06.csv"',
    );
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(body.subarray(3).toString()).toBe('orders csv');
    expect(mocks.getReportsScreenDataForStaff).toHaveBeenCalledWith(
      selected,
      {
        range: '7d',
        from: undefined,
        to: undefined,
        includeLines: false,
        orderLimit: 10_000,
      },
    );
    expect(mocks.ordersCsv).toHaveBeenCalledOnce();
  });

  it('exports item lines for a Manager', async () => {
    const selected = context('manager');
    mocks.getStaffContextDetailed.mockResolvedValue({ ok: true, context: selected });

    const response = await GET(request('/dashboard/reports/export?type=items&range=30d'));

    expect(response.status).toBe(200);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(body.subarray(3).toString()).toBe('items csv');
    expect(mocks.getReportsScreenDataForStaff).toHaveBeenCalledWith(
      selected,
      {
        range: '30d',
        from: undefined,
        to: undefined,
        includeLines: true,
        orderLimit: 10_000,
      },
    );
    expect(mocks.itemsCsv).toHaveBeenCalledOnce();
  });

  it('returns a safe service error when staff context resolution throws', async () => {
    mocks.getStaffContextDetailed.mockRejectedValue(new Error('internal auth detail'));

    const response = await GET(request('/dashboard/reports/export?type=summary'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'The report could not be exported. Please try again.' });
    expect(mocks.getReportsScreenDataForStaff).not.toHaveBeenCalled();
  });
});
