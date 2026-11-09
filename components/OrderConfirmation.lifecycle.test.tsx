// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollerDeps } from '@/lib/order-status-poller';

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), deps: null as PollerDeps | null, stop: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock('@/lib/order-status-poller', () => ({ createStatusPoller: (deps: PollerDeps) => {
  mocks.deps = deps;
  return { start: vi.fn(), stop: mocks.stop, pollNow: vi.fn() };
} }));
import { CartProvider } from './CartProvider';
import { ClearCartOnOrder } from './ClearCartOnOrder';
import { ReorderOffer } from './ReorderOffer';
import { OrderStatusRefresh } from './OrderStatusRefresh';
import { cartKey } from '@/lib/cart-storage';
import { readLastCart } from '@/lib/guest-orders';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); vi.clearAllMocks(); mocks.deps = null;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('order confirmation lifecycle', () => {
  it('offers the newly saved cart without requiring a reload and restores quantities', async () => {
    localStorage.setItem(cartKey('test'), JSON.stringify([{ itemId: 'dish-1', qty: 2 }]));
    await act(async () => root.render(<CartProvider slug="test"><ClearCartOnOrder clear slug="test" /><ReorderOffer slug="test" /></CartProvider>));
    expect(localStorage.getItem(cartKey('test'))).toBeNull();
    expect(readLastCart(localStorage, 'test')).toEqual([{ itemId: 'dish-1', qty: 2 }]);
    const button = host.querySelector<HTMLButtonElement>('[data-reorder-button]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(JSON.parse(localStorage.getItem(cartKey('test'))!)).toEqual([{ itemId: 'dish-1', qty: 2 }]);
    expect(mocks.push).toHaveBeenCalledWith('/menu/cart?s=test');
  });

  it('does not clear a new cart while opening historical orders', async () => {
    const raw = JSON.stringify([{ itemId: 'dish-2', qty: 1 }]);
    localStorage.setItem(cartKey('test'), raw);
    await act(async () => root.render(<CartProvider slug="test"><ClearCartOnOrder clear={false} slug="test" /><ReorderOffer slug="test" /></CartProvider>));
    expect(localStorage.getItem(cartKey('test'))).toBe(raw);
    expect(host.querySelector('[data-reorder-button]')).toBeNull();
  });

  it.each(['preparing', 'cancelled'] as const)('refreshes an editable new order when the kitchen marks it %s, but not on unchanged polls', async status => {
    await act(async () => root.render(<OrderStatusRefresh slug="test" code="TE-ABC12" token="private-token" status="new" awaitingConfirmation={false} paymentStatus="pending" />));
    const snapshot = { status: 'new' as const, awaitingConfirmation: false, paymentStatus: 'pending' as const, placedAt: '2026-11-01T00:00:00Z', checkedAt: '2026-11-01T00:01:00Z' };
    mocks.deps!.onSnapshot(snapshot);
    expect(mocks.refresh).not.toHaveBeenCalled();
    mocks.deps!.onSnapshot({ ...snapshot, status });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    mocks.deps!.onSnapshot({ ...snapshot, status });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    const old = mocks.deps!;
    await act(async () => root.unmount());
    expect(mocks.stop).toHaveBeenCalled();
    old.onSnapshot({ ...snapshot, status });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });
});
