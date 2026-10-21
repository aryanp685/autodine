'use client';

/**
 * "Pay ₹X online" on the guest's own order page.
 *
 * WHAT HAPPENS WHEN IT IS PRESSED
 *
 *   1. A server action opens a payment attempt (amount read from the database,
 *      not from this component).
 *   2. The provider's checkout window opens with the id it returned.
 *   3. The window hands back a signature. It is posted to our route, which
 *      checks it before anything is marked paid.
 *   4. The page reloads and shows the order as paid.
 *
 * Every one of those steps can fail, and each failure gets its own sentence.
 * The one thing this component never does is tell the guest they have paid:
 * that comes back from the server, and only after a signature check.
 *
 * WHY THE SCRIPT IS LOADED ON DEMAND
 *
 * The checkout script is ~100 KB from the provider's domain. Loading it on
 * every order confirmation, for guests who will pay cash at the counter,
 * would slow the one page a hungry person is standing in front of.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import { startOnlinePaymentAction } from '@/app/menu/order/pay-actions';

type CheckoutResponse = {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
};

type RazorpayInstance = { open: () => void; on: (event: string, handler: () => void) => void };

type RazorpayWindow = Window & {
  Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
};

const SCRIPT_ID = 'razorpay-checkout';
const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadCheckout(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if ((window as RazorpayWindow).Razorpay) return resolve(true);
      existing.addEventListener('load', () => resolve(Boolean((window as RazorpayWindow).Razorpay)));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean((window as RazorpayWindow).Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

type Status =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string }
  | { kind: 'paid' };

export function PayOnline({
  slug,
  code,
  token,
  duePaise,
}: {
  slug: string;
  code: string;
  token: string;
  duePaise: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function pay() {
    setStatus({ kind: 'starting' });

    const started = await startOnlinePaymentAction(slug, code, token);
    if (!started.ok) {
      setStatus({ kind: 'error', message: started.error });
      return;
    }

    const loaded = await loadCheckout();
    if (!loaded) {
      setStatus({
        kind: 'error',
        message: 'The payment window could not load. Check your connection, or pay at the counter.',
      });
      return;
    }

    const Razorpay = (window as RazorpayWindow).Razorpay;
    if (!Razorpay) {
      setStatus({ kind: 'error', message: 'The payment window could not open. Please pay at the counter.' });
      return;
    }

    const checkout = new Razorpay({
      key: started.keyId,
      order_id: started.providerOrderId,
      amount: started.amountPaise,
      currency: 'INR',
      name: started.restaurantName,
      description: `Order ${started.orderCode}`,
      // No prefill and no theme: the guest has told us nothing, and inventing
      // a colour here would be a hex value outside the design system.
      handler: (response: CheckoutResponse) => {
        void verify(response);
      },
      modal: {
        ondismiss: () => {
          setStatus({ kind: 'idle' });
        },
      },
    });

    checkout.on('payment.failed', () => {
      setStatus({
        kind: 'error',
        message: 'That payment did not go through, so nothing was charged. Try again or pay at the counter.',
      });
    });

    checkout.open();
  }

  async function verify(response: CheckoutResponse) {
    setStatus({ kind: 'verifying' });

    try {
      const result = await fetch('/api/payments/razorpay/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });

      const payload = (await result.json().catch(() => ({}))) as { ok?: boolean; error?: string };

      if (!result.ok || payload.ok !== true) {
        setStatus({
          kind: 'error',
          message:
            payload.error ??
            'We could not confirm that payment. Show this screen to staff — do not pay again.',
        });
        return;
      }

      setStatus({ kind: 'paid' });
      // The server owns the truth; re-read the page rather than trusting the
      // response we just got.
      router.refresh();
    } catch {
      setStatus({
        kind: 'error',
        message: 'We could not reach the server to confirm that payment. Show this screen to staff — do not pay again.',
      });
    }
  }

  const busy = status.kind === 'starting' || status.kind === 'verifying';

  return (
    <div className="pg__form">
      <button
        type="button"
        className="pg__submit"
        onClick={pay}
        disabled={busy || status.kind === 'paid'}
      >
        {status.kind === 'starting'
          ? 'Opening the payment window…'
          : status.kind === 'verifying'
            ? 'Confirming the payment…'
            : status.kind === 'paid'
              ? 'Paid'
              : `Pay ${inr(paiseToRupees(duePaise))} online`}
      </button>

      {status.kind === 'error' && (
        <p className="cart__fine" role="alert">
          <strong>Nothing was recorded as paid.</strong> {status.message}
        </p>
      )}

      {status.kind === 'paid' && (
        <p className="cart__fine" role="status">
          Payment confirmed. The counter has it too — nothing more to do.
        </p>
      )}

      {status.kind === 'idle' && (
        <p className="cart__fine">
          Card or UPI, through the payment gateway. The kitchen is already cooking; paying now saves you a
          queue at the counter.
        </p>
      )}
    </div>
  );
}
