import { describe, expect, it } from 'vitest';
import { MIN_ONLINE_PAISE, onlinePaymentOffer } from './online-availability';

/**
 * Five ways to not offer a pay button, and one way to offer it. The failure
 * that matters is the inverse: a button shown when the deployment cannot
 * verify a payment, which ends with a guest paying and nothing to show for it.
 */

const base = {
  enabled: true,
  configured: true,
  paymentStatus: 'pending',
  prepStatus: 'new',
  duePaise: 330282,
  hasToken: true,
};

describe('onlinePaymentOffer', () => {
  it('offers the button when everything lines up', () => {
    expect(onlinePaymentOffer(base)).toEqual({ available: true, note: null });
  });

  it('never offers a button without a gateway key pair', () => {
    const offer = onlinePaymentOffer({ ...base, configured: false });
    expect(offer.available).toBe(false);
    expect(offer.note).toMatch(/not connected/i);
  });

  it('never offers a button when the owner has not switched it on', () => {
    const offer = onlinePaymentOffer({ ...base, enabled: false });
    expect(offer.available).toBe(false);
    expect(offer.note).toMatch(/counter/i);
  });

  it('says nothing once the order is paid', () => {
    expect(onlinePaymentOffer({ ...base, paymentStatus: 'paid' })).toEqual({ available: false, note: null });
  });

  it('says nothing on a cancelled order, even if it looks unpaid', () => {
    expect(onlinePaymentOffer({ ...base, prepStatus: 'cancelled' })).toEqual({
      available: false,
      note: null,
    });
  });

  it('says nothing when the guest has no token', () => {
    expect(onlinePaymentOffer({ ...base, hasToken: false })).toEqual({ available: false, note: null });
  });

  it('says nothing when nothing is owed', () => {
    expect(onlinePaymentOffer({ ...base, duePaise: 0 })).toEqual({ available: false, note: null });
    expect(onlinePaymentOffer({ ...base, duePaise: -500 })).toEqual({ available: false, note: null });
  });

  it('refuses amounts below the provider minimum', () => {
    expect(onlinePaymentOffer({ ...base, duePaise: MIN_ONLINE_PAISE - 1 }).available).toBe(false);
    expect(onlinePaymentOffer({ ...base, duePaise: MIN_ONLINE_PAISE }).available).toBe(true);
  });

  it('keeps the note honest when the owner switched it on but the keys are missing', () => {
    const offer = onlinePaymentOffer({ ...base, configured: false });
    expect(offer.note).toMatch(/not connected/i);
    expect(offer.note).toMatch(/counter/i);
  });
});
