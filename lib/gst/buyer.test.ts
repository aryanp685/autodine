import { expect, it } from 'vitest';
import { normalizeCheckoutRecipient, type CheckoutRecipient } from './buyer';
import { SYNTHETIC_BUYER } from './test-fixtures';

it('does not silently discard an unsupported supply marker or tax override', () => {
  const valid = { gstin:SYNTHETIC_BUYER, name:'Synthetic buyer', address:'1 Synthetic Road' };
  expect(normalizeCheckoutRecipient(valid)).toMatchObject({ok:true});
  for (const extra of [{supply_kind:'SEZ'},{place_of_supply_state_code:'29'},{tax_rate_bps:1800}]) {
    expect(normalizeCheckoutRecipient({...valid,...extra} as CheckoutRecipient)).toMatchObject({ok:false});
  }
});

it('requires a current saved buyer ID and revision without caller overrides', () => {
  const buyer_id = '54f02414-4512-4181-8080-0098882fdc7c';
  expect(normalizeCheckoutRecipient({ buyer_id, revision:2 })).toEqual({ok:true,data:{buyer_id,revision:2}});
  expect(normalizeCheckoutRecipient({ buyer_id, revision:2, name:'Override' })).toMatchObject({ok:false});
  expect(normalizeCheckoutRecipient({ buyer_id, revision:0 })).toMatchObject({ok:false});
});
