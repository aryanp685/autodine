import { describe, expect, it } from 'vitest';
import { addCartLine, setCartLineQuantity, updateScopedCart, type CartLine } from './cart-state';

const paneer: Omit<CartLine, 'key'> = {
  id: 'item-1',
  name: 'Paneer Tikka',
  unitPricePaise: 24000,
  qty: 1,
  veg: true,
};

describe('restaurant-scoped preview cart', () => {
  it('keeps each restaurant cart isolated', () => {
    const original = new Map<string, CartLine[]>();
    const restaurantA = updateScopedCart(original, 'venue-a', (lines) => addCartLine(lines, paneer));
    const restaurantB = updateScopedCart(restaurantA, 'venue-b', (lines) => addCartLine(lines, { ...paneer, id: 'item-2', name: 'Dal' }));

    expect(original.size).toBe(0);
    expect(restaurantB.get('venue-a')?.map((line) => line.id)).toEqual(['item-1']);
    expect(restaurantB.get('venue-b')?.map((line) => line.id)).toEqual(['item-2']);
  });

  it('merges only identical menu choices', () => {
    const first = addCartLine([], paneer);
    const merged = addCartLine(first, paneer);
    const differentVariant = addCartLine(merged, { ...paneer, variant: 'large' });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.qty).toBe(2);
    expect(differentVariant).toHaveLength(2);
  });

  it('keeps stable variant IDs distinct even when display names match', () => {
    const first = addCartLine([], { ...paneer, variant: 'Regular', variantId: 'variant-1' });
    const second = addCartLine(first, { ...paneer, variant: 'Regular', variantId: 'variant-2' });
    expect(second).toHaveLength(2);
    expect(second.map((line) => line.variantId)).toEqual(['variant-1', 'variant-2']);
  });

  it('removes a line when its quantity reaches zero', () => {
    const lines = addCartLine([], paneer);
    expect(setCartLineQuantity(lines, lines[0]!.key, 0)).toEqual([]);
  });
});
