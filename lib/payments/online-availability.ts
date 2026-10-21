/**
 * Should this order offer "pay online", and if not, what should the guest be
 * told instead?
 *
 * WHY A SEPARATE, PURE FUNCTION
 *
 * There are five different reasons the button must not appear, and each has a
 * different sentence. Spread across a page component they drift; the guest
 * ends up reading "pay at the counter" on a restaurant that does take cards,
 * or worse, seeing a button that cannot work.
 *
 * The rule that matters most: a checkout window is only offered when the
 * deployment can actually verify a payment. A button that opens a payment
 * sheet nobody can settle is the "looks like it works" failure this product
 * keeps being told to avoid.
 *
 * Nothing here reads the environment; the caller passes `configured`. That
 * keeps this testable and keeps node:crypto out of anything that might be
 * rendered in a browser.
 */

export type OnlineOfferInput = {
  /** restaurants.online_payments_enabled — the owner's switch. */
  enabled: boolean;
  /** This deployment has a gateway key pair. */
  configured: boolean;
  /** orders.payment_status. */
  paymentStatus: string;
  /** orders.prep_status. */
  prepStatus: string;
  /** What is still owed, in paise, after any recorded payments. */
  duePaise: number;
  /** Did the caller arrive with the guest token? Without it, nothing is offered. */
  hasToken?: boolean;
};

export type OnlineOffer = {
  /** Render the pay button. */
  available: boolean;
  /**
   * What to say when it is not available, or null when there is nothing worth
   * saying (the order is settled, cancelled, or the guest has no token).
   */
  note: string | null;
};

/** Razorpay will not accept less than ₹1. */
export const MIN_ONLINE_PAISE = 100;

export function onlinePaymentOffer(input: OnlineOfferInput): OnlineOffer {
  // Nothing is owed or nothing can be done: say nothing at all.
  if (input.prepStatus === 'cancelled') return { available: false, note: null };
  if (input.paymentStatus !== 'pending') return { available: false, note: null };
  if (input.hasToken === false) return { available: false, note: null };
  if (input.duePaise <= 0) return { available: false, note: null };

  if (!input.enabled) {
    return { available: false, note: 'This restaurant takes payment at the counter.' };
  }

  if (!input.configured) {
    // The owner switched it on but the deployment has no keys. Saying "card
    // payment" without saying it is off would leave the guest looking for a
    // button. Saying it is at the counter while the owner believes otherwise
    // is still better than a dead button.
    return {
      available: false,
      note: 'Card payment is not connected on this deployment yet — pay at the counter.',
    };
  }

  if (input.duePaise < MIN_ONLINE_PAISE) {
    return { available: false, note: 'That amount is too small for a card payment — pay at the counter.' };
  }

  return { available: true, note: null };
}
