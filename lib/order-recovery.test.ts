import { describe, expect, it } from 'vitest';
import type { StorageLike } from '@/lib/guest-orders';
import {
  buildCartSignature,
  clearPendingOrderAttempt,
  ensurePendingAttemptToken,
  markPendingOrderOutcome,
  markPendingOrderSubmitting,
  readPendingCounterOrders,
  readPendingOrderAttempt,
  removePendingCounterOrder,
  upsertPendingCounterOrder,
} from './order-recovery';

function memStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('order-recovery (guest pending & failed attempts)', () => {
  const lines = [
    { itemId: 'item-2', qty: 1 },
    { itemId: 'item-1', qty: 2, variantId: 'v-half', addonIds: ['a2', 'a1'] },
  ];

  it('builds a deterministic cart signature independent of line/addon ordering', () => {
    const a = buildCartSignature(lines);
    const b = buildCartSignature([
      { itemId: 'item-1', qty: 2, variantId: 'v-half', addonIds: ['a1', 'a2'] },
      { itemId: 'item-2', qty: 1 },
    ]);
    expect(a).toBe(b);
  });

  it('reuses the exact attempt token across retries/reloads of the same cart', () => {
    const storage = memStorage();
    const first = ensurePendingAttemptToken(storage, 'maddi', lines);
    expect(first.reused).toBe(false);

    markPendingOrderSubmitting(storage, {
      attemptToken: first.token,
      slug: 'maddi',
      lines,
      note: 'Less spicy',
    });

    const retry = ensurePendingAttemptToken(storage, 'maddi', lines);
    expect(retry.reused).toBe(true);
    expect(retry.token).toBe(first.token);

    const failed = markPendingOrderOutcome(storage, 'maddi', 'failed', {
      errorMessage: 'Connection timed out',
      errorCode: 'net',
    });
    expect(failed?.status).toBe('failed');
    expect(failed?.errorMessage).toBe('Connection timed out');

    const afterFail = ensurePendingAttemptToken(storage, 'maddi', lines);
    expect(afterFail.reused).toBe(true);
    expect(afterFail.token).toBe(first.token);
  });

  it('mints a fresh attempt token when the cart changes or after confirmation clears it', () => {
    const storage = memStorage();
    const first = ensurePendingAttemptToken(storage, 'maddi', lines);
    markPendingOrderSubmitting(storage, {
      attemptToken: first.token,
      slug: 'maddi',
      lines,
    });

    const modified = ensurePendingAttemptToken(storage, 'maddi', [{ itemId: 'item-1', qty: 3 }]);
    expect(modified.reused).toBe(false);
    expect(modified.token).not.toBe(first.token);

    clearPendingOrderAttempt(storage, 'maddi');
    expect(readPendingOrderAttempt(storage, 'maddi')).toBeNull();
  });

  it('expires stale pending attempts after TTL', () => {
    const storage = memStorage();
    const oldIso = '2026-11-20T08:00:00.000Z';
    const token = '11111111-1111-4111-8111-111111111111';
    markPendingOrderSubmitting(storage, {
      attemptToken: token,
      slug: 'maddi',
      lines,
      nowIso: oldIso,
    });

    const stillFresh = readPendingOrderAttempt(storage, 'maddi', Date.parse('2026-11-20T09:00:00.000Z'));
    expect(stillFresh?.attemptToken).toBe(token);

    const expired = readPendingOrderAttempt(storage, 'maddi', Date.parse('2026-11-20T11:30:00.000Z'));
    expect(expired).toBeNull();
  });
});

describe('order-recovery (staff counter pending queue)', () => {
  it('retains failed counter orders by idempotencyKey and removes on success', () => {
    const storage = memStorage();
    const key = '22222222-2222-4222-8222-222222222222';

    upsertPendingCounterOrder(storage, 'rest-1', {
      idempotencyKey: key,
      channel: 'takeaway',
      tableId: null,
      tableLabel: null,
      lines: [{ itemId: '33333333-3333-4333-8333-333333333333', qty: 2 }],
      itemCount: 2,
      note: 'No onion',
      customerName: 'Asha',
      customerPhone: '',
      status: 'failed',
      errorMessage: 'Network offline',
      createdAt: '2026-11-20T12:00:00Z',
      updatedAt: '2026-11-20T12:00:05Z',
    });

    const list = readPendingCounterOrders(storage, 'rest-1', Date.parse('2026-11-20T12:05:00Z'));
    expect(list).toHaveLength(1);
    expect(list[0]?.idempotencyKey).toBe(key);
    expect(list[0]?.errorMessage).toBe('Network offline');

    const afterRemove = removePendingCounterOrder(storage, 'rest-1', key);
    expect(afterRemove).toHaveLength(0);
  });
});
