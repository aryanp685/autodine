import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffResult: null as unknown,
  generateDescriptions: vi.fn(),
  translateBatch: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock('@/lib/db/staff', () => ({ getStaffContextDetailed: () => Promise.resolve(mocks.staffResult) }));
vi.mock('@/lib/ai/describe', () => ({ generateDescriptions: mocks.generateDescriptions }));
vi.mock('@/lib/ai/translate', () => ({ translateBatch: mocks.translateBatch }));

import { generateDescriptionsAction, generateTranslationsAction } from './actions';

function queryResult(rows: Record<string, unknown>[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    then: (resolve?: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return builder;
}

function staffResult(role: 'owner' | 'manager' | 'cashier' | 'kitchen') {
  const from = vi.fn((table: string) =>
    queryResult(table === 'items'
      ? [{ id: 'dish-1', name: 'Paneer Tikka', category_id: 'category-1', description: 'Charred paneer', categories: { name: 'Starters' } }]
      : [{ id: 'category-1', name: 'Starters' }]),
  );
  return {
    value: {
      ok: true,
      context: { supabase: { from }, restaurantId: 'restaurant-1', role },
    },
    from,
  };
}

const descriptionPayload = [{ id: 'dish-1' }];
const translationPayload = { language: 'hi' as const, targets: [{ id: 'dish-1', kind: 'item' as const }] };

beforeEach(() => {
  mocks.staffResult = null;
  mocks.generateDescriptions.mockReset().mockResolvedValue([{ id: 'dish-1', ok: true, description: 'A test description.' }]);
  mocks.translateBatch.mockReset().mockResolvedValue([{ id: 'dish-1', ok: true, name: 'पनीर टिक्का', description: 'चारकोल्ड पनीर' }]);
});

describe('menu AI Server Action authorization', () => {
  it.each(['cashier', 'kitchen'] as const)('%s cannot invoke description generation or read menu targets', async (role) => {
    const staff = staffResult(role);
    mocks.staffResult = staff.value;

    const results = await generateDescriptionsAction(descriptionPayload);

    expect(results).toEqual([
      { id: 'dish-1', ok: false, reason: 'Only an owner or manager can generate menu content.' },
    ]);
    expect(staff.from).not.toHaveBeenCalled();
    expect(mocks.generateDescriptions).not.toHaveBeenCalled();
  });

  it.each(['cashier', 'kitchen'] as const)('%s cannot invoke translation generation or read menu targets', async (role) => {
    const staff = staffResult(role);
    mocks.staffResult = staff.value;

    const results = await generateTranslationsAction(translationPayload);

    expect(results).toEqual([
      { id: 'dish-1', ok: false, reason: 'Only an owner or manager can generate menu content.' },
    ]);
    expect(staff.from).not.toHaveBeenCalled();
    expect(mocks.translateBatch).not.toHaveBeenCalled();
  });

  it.each(['owner', 'manager'] as const)('%s can use the description and translation review actions', async (role) => {
    const staff = staffResult(role);
    mocks.staffResult = staff.value;

    await expect(generateDescriptionsAction(descriptionPayload)).resolves.toEqual([
      { id: 'dish-1', ok: true, description: 'A test description.' },
    ]);
    await expect(generateTranslationsAction(translationPayload)).resolves.toEqual([
      { id: 'dish-1', ok: true, name: 'पनीर टिक्का', description: 'चारकोल्ड पनीर' },
    ]);

    expect(staff.from).toHaveBeenCalled();
    expect(mocks.generateDescriptions).toHaveBeenCalledOnce();
    expect(mocks.translateBatch).toHaveBeenCalledOnce();
  });
});
