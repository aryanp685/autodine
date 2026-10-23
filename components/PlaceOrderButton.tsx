'use client';

/**
 * The two Place order buttons on the pay screen, both honest about being busy.
 *
 * WHY THIS IS A COMPONENT AND NOT A `disabled` EXPRESSION
 *
 * Placing an order is a server action that redirects. Between the tap and the
 * redirect there is a real pause -- a database call that prices every line --
 * and nothing on the screen changed during it. So a guest taps again, and a
 * second order is written. The button said "Place order · ₹856" throughout.
 *
 * `useFormStatus` is the only honest source for that state: it is true from the
 * submit until the action settles, which is exactly the window in which a
 * second tap would be a duplicate. It has to be read by a component rendered
 * INSIDE the <form>, which is why both buttons live here and both are declared
 * as submits rather than as a button that calls the action itself.
 *
 * The docked bar and the bill each render one. They are the same form, so both
 * go busy together -- two buttons that disagree about whether the order is
 * being placed would be worse than no feedback at all.
 */

import { useFormStatus } from 'react-dom';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';

export function PlaceOrderButton({
  totalPaise,
  canOrder,
  form,
  variant,
}: {
  totalPaise: number;
  canOrder: boolean;
  /** The id of the form this button submits, when it is not a descendant. */
  form: string;
  /** `bill` sits in the summary card; `dock` is the pinned bar on a phone. */
  variant: 'bill' | 'dock';
}) {
  const { pending } = useFormStatus();

  const label = !canOrder
    ? 'Add items before checkout'
    : pending
      ? 'Placing your order…'
      : variant === 'dock'
        ? 'Place order'
        : `Place order · ${inr(paiseToRupees(totalPaise))}`;

  return (
    <button
      type="submit"
      form={form}
      data-place-order={variant}
      className={[
        'inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[0.99] disabled:opacity-50',
        variant === 'dock'
          ? 'h-12 flex-1 rounded-full bg-[var(--p-accent)] px-5 text-[14px] text-white shadow-g1'
          : 'mt-4 h-12 w-full rounded-full bg-gink px-5 text-[13.5px] text-onink',
      ].join(' ')}
      disabled={!canOrder || pending}
      aria-busy={pending || undefined}
    >
      {pending ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80"
        />
      ) : null}
      {label}
    </button>
  );
}
