import { describe, expect, it } from 'vitest';
import { missedOrderStorageKey, readMissedOrderIds, writeMissedOrderIds } from './kitchen-missed';

function storageStub(): Storage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe('missed kitchen order persistence', () => {
  it('persists only unique order IDs and restores them per restaurant', () => {
    const storage = storageStub();
    writeMissedOrderIds(storage, 'restaurant-a', ['order-1', 'order-1', 'order-2']);

    expect(readMissedOrderIds(storage, 'restaurant-a')).toEqual(['order-1', 'order-2']);
    expect(readMissedOrderIds(storage, 'restaurant-b')).toEqual([]);
    expect(missedOrderStorageKey('restaurant-a')).not.toBe(missedOrderStorageKey('restaurant-b'));
  });

  it('bounds persisted recovery keys and ignores malformed storage', () => {
    const storage = storageStub();
    writeMissedOrderIds(storage, 'restaurant-a', Array.from({ length: 120 }, (_, i) => `o${i}`));
    expect(readMissedOrderIds(storage, 'restaurant-a')).toHaveLength(100);
    expect(readMissedOrderIds(storage, 'restaurant-a')[0]).toBe('o20');

    storage.setItem(missedOrderStorageKey('restaurant-b'), '{broken');
    expect(readMissedOrderIds(storage, 'restaurant-b')).toEqual([]);
  });
});
