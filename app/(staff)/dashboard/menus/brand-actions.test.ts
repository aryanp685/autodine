import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staff: { result: null as unknown },
  response: null as unknown,
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => mocks.revalidatePath(path) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@/lib/db/staff', () => ({
  getStaffContextDetailed: () => Promise.resolve(mocks.staff.result),
}));
vi.mock('@/app/(staff)/dashboard/menus/import-actions', () => ({
  createImportedMenuAction: vi.fn(),
}));
vi.mock('@/lib/ai/brand-vision', () => ({
  extractBrandFromImage: vi.fn(),
  validateBrandCapture: vi.fn(),
}));
vi.mock('@/lib/branding/brand-data', () => ({
  publishPair: vi.fn(),
  recordBrandAsset: vi.fn(),
  rollbackLastPublish: vi.fn(),
  upsertBrandDraft: vi.fn(),
}));
vi.mock('@/lib/branding/draft', () => ({ sanitiseBrandDraft: vi.fn() }));
vi.mock('@/lib/branding/designs', () => ({ designCandidates: vi.fn(() => []) }));
vi.mock('@/lib/branding/theme', () => ({ parseTheme: vi.fn() }));
vi.mock('@/lib/branding/uploads', () => ({
  prepareAsset: vi.fn(),
  assetObjectPath: vi.fn(),
}));
vi.mock('@/lib/storage/assets', () => ({ publicAssetUrl: vi.fn() }));

import { updateAnnouncementAction, updateOrderingStatusAction } from './brand-actions';

function staff(role: 'owner' | 'manager' | 'cashier' | 'kitchen' = 'owner') {
  mocks.staff.result = {
    ok: true,
    context: {
      role,
      restaurantId: 'restaurant-1',
      supabase: { from: mocks.from },
    },
  };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('redirect:')) return message.slice('redirect:'.length);
    throw error;
  }
  throw new Error('the action returned instead of redirecting');
}

function resultUrl(path: string) {
  return new URL(path, 'https://autodine.test');
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.select.mockReset();
  mocks.redirect.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.response = { data: [{ id: 'restaurant-1' }], error: null };

  const query = {
    update: mocks.update,
    eq: mocks.eq,
    select: mocks.select,
  };
  mocks.from.mockReturnValue(query);
  mocks.update.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.select.mockImplementation(() => Promise.resolve(mocks.response));
  staff();
});

describe('restaurant settings actions report only confirmed writes', () => {
  it('confirms an announcement only after the restaurant row was updated', async () => {
    const url = await redirectOf(() => updateAnnouncementAction(form({ text: '  Kitchen   closes at 10  ', on: 'on' })));

    expect(resultUrl(url).searchParams.get('notice')).toBe('The announcement is on the guest menu now.');
    expect(resultUrl(url).searchParams.has('error')).toBe(false);
    expect(mocks.from).toHaveBeenCalledWith('restaurants');
    expect(mocks.update).toHaveBeenCalledWith({ announcement_text: 'Kitchen closes at 10', announcement_on: true });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'restaurant-1');
    expect(mocks.select).toHaveBeenCalledWith('id');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/menu');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/dashboard/branding');
  });

  it('does not report success or revalidate when RLS matches no announcement row', async () => {
    mocks.response = { data: [], error: null };

    const url = await redirectOf(() => updateAnnouncementAction(form({ text: 'Closed for lunch', on: 'on' })));

    expect(resultUrl(url).searchParams.get('error')).toBe('Could not save the announcement. Nothing was changed.');
    expect(resultUrl(url).searchParams.has('notice')).toBe(false);
    expect(mocks.select).toHaveBeenCalledWith('id');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('confirms an ordering-status change only after the restaurant row was updated', async () => {
    const url = await redirectOf(() => updateOrderingStatusAction(form({ open: 'closed' })));

    expect(resultUrl(url).searchParams.get('notice')).toContain('Your storefront is closed.');
    expect(resultUrl(url).searchParams.has('error')).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith({ is_active: false });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'restaurant-1');
    expect(mocks.select).toHaveBeenCalledWith('id');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/menu');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/dashboard/branding');
  });

  it('does not claim the storefront changed when RLS matches no restaurant row', async () => {
    mocks.response = { data: [], error: null };

    const url = await redirectOf(() => updateOrderingStatusAction(form({ open: 'closed' })));

    expect(resultUrl(url).searchParams.get('error')).toBe('Could not save the ordering status. Nothing was changed.');
    expect(resultUrl(url).searchParams.has('notice')).toBe(false);
    expect(mocks.select).toHaveBeenCalledWith('id');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('allows a Manager to use both role-gated restaurant settings actions', async () => {
    staff('manager');

    const announcementUrl = await redirectOf(() => updateAnnouncementAction(form({ text: 'Notice', on: 'on' })));
    expect(resultUrl(announcementUrl).searchParams.get('notice')).toBe('The announcement is on the guest menu now.');

    const orderingUrl = await redirectOf(() => updateOrderingStatusAction(form({ open: 'closed' })));
    expect(resultUrl(orderingUrl).searchParams.get('notice')).toContain('Your storefront is closed.');
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it('does not convert announcement database errors into success', async () => {
    mocks.response = { data: null, error: { message: 'permission denied for table restaurants' } };

    const url = await redirectOf(() => updateAnnouncementAction(form({ text: 'Notice', on: 'on' })));

    expect(resultUrl(url).searchParams.get('error')).toContain('Could not save the announcement');
    expect(resultUrl(url).searchParams.has('notice')).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('does not convert storefront database errors into success', async () => {
    mocks.response = { data: null, error: { message: 'permission denied for table restaurants' } };

    const url = await redirectOf(() => updateOrderingStatusAction(form({ open: 'closed' })));

    expect(resultUrl(url).searchParams.get('error')).toContain('Could not save the ordering status');
    expect(resultUrl(url).searchParams.has('notice')).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('blocks an operational staff role before sending either write', async () => {
    staff('cashier');

    const announcementUrl = await redirectOf(() => updateAnnouncementAction(form({ text: 'Notice', on: 'on' })));
    expect(resultUrl(announcementUrl).searchParams.get('error')).toMatch(/owner or manager/i);

    const orderingUrl = await redirectOf(() => updateOrderingStatusAction(form({ open: 'closed' })));
    expect(resultUrl(orderingUrl).searchParams.get('error')).toMatch(/owner or manager/i);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
