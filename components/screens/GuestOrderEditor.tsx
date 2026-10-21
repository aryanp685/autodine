'use client';

/**
 * The two things a guest can still do to their own order: change how many of
 * something, or cancel the whole thing.
 *
 * Both stop being possible the moment the kitchen starts (or money changes
 * hands), and the database is the one that decides -- this component only
 * refrains from drawing a button the database would refuse. When it is not
 * possible, the screen says why in one line rather than hiding the controls
 * and leaving the guest to wonder.
 *
 * Prices are never computed here. The subtotal shown while editing is plain
 * multiplication of the unit price that is already on the screen, so it cannot
 * disagree with the bill; tax and total are left to the database and appear
 * after Save.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import { VegMark } from '@/components/ui';
import type { OrderLine } from '@/lib/db/order-screen';
import { cancelGuestOrderAction, setGuestOrderLinesAction } from '@/app/menu/order/actions';

type Props = {
  orderId: string;
  token: string;
  lines: OrderLine[];
  /** prep 'new', unpaid, and inside the ten minute window. */
  canEdit: boolean;
  /** Why editing is off, in the guest's words. Empty when it is on. */
  lockedReason: string;
  subtotalPaise: number;
};

export function GuestOrderEditor({
  orderId,
  token,
  lines,
  canEdit,
  lockedReason,
  subtotalPaise,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.qty])),
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);

  const dirty = lines.some((l) => (qty[l.id] ?? l.qty) !== l.qty);
  const nextSubtotal = lines.reduce(
    (sum, l) => sum + l.unitPricePaise * Math.max(0, qty[l.id] ?? l.qty),
    0,
  );
  const remaining = lines.filter((l) => Math.max(0, qty[l.id] ?? l.qty) > 0).length;

  function step(line: OrderLine, delta: number) {
    setError('');
    setNotice('');
    setQty((current) => {
      const now = current[line.id] ?? line.qty;
      return { ...current, [line.id]: Math.max(0, Math.min(99, now + delta)) };
    });
  }

  function save() {
    setError('');
    setNotice('');
    startTransition(async () => {
      const result = await setGuestOrderLinesAction({
        orderId,
        token,
        lines: lines.map((l) => ({ lineId: l.id, qty: qty[l.id] ?? l.qty })),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setNotice(result.message);
      router.refresh();
    });
  }

  function cancel() {
    setError('');
    setNotice('');
    startTransition(async () => {
      const result = await cancelGuestOrderAction({ orderId, token });

      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }

      setNotice(result.message);
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      {lines.map((l) => {
        const now = qty[l.id] ?? l.qty;
        const removed = canEdit && now === 0;

        return (
          <div
            key={l.id}
            className="cart__line"
            style={removed ? { opacity: 0.55 } : undefined}
          >
            <div className="cart__lineMain">
              <div className="cart__lineTop">
                <VegMark veg={l.isVeg} />
                <strong style={removed ? { textDecoration: 'line-through' } : undefined}>
                  {l.name}
                </strong>
                {l.variantName ? <em className="co__variant"> · {l.variantName}</em> : null}
              </div>
              {l.addons.length > 0 ? (
                <div className="cart__linePrice">+ {l.addons.join(', ')}</div>
              ) : null}
              <div className="cart__linePrice tnum">
                {inr(paiseToRupees(l.unitPricePaise))} each
                {removed ? ' · will be removed' : ''}
              </div>
            </div>

            {canEdit ? (
              <div className="cart__qty">
                <button
                  type="button"
                  onClick={() => step(l, -1)}
                  disabled={pending || now === 0}
                  aria-label={`One fewer ${l.name}`}
                >
                  −
                </button>
                <span className="tnum">{now}</span>
                <button
                  type="button"
                  onClick={() => step(l, +1)}
                  disabled={pending || now >= 99}
                  aria-label={`One more ${l.name}`}
                >
                  +
                </button>
              </div>
            ) : (
              <div className="cart__qty">
                <span className="tnum">{l.qty}</span>
              </div>
            )}

            <div className="cart__lineTotal tnum">
              {removed ? '—' : inr(paiseToRupees(l.unitPricePaise * now))}
            </div>
          </div>
        );
      })}

      <div aria-live="polite">
        {error ? (
          <p className="cart__fine" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p className="cart__fine">{notice}</p> : null}
      </div>

      {canEdit ? (
        <div className="cart__fine">
          {dirty ? (
            <p>
              New subtotal {inr(paiseToRupees(nextSubtotal))}
              {nextSubtotal !== subtotalPaise ? ` (was ${inr(paiseToRupees(subtotalPaise))})` : ''}
              . Taxes and the total are recalculated when you save.
              {remaining === 0 ? ' At least one dish has to stay on the order.' : ''}
            </p>
          ) : (
            <p>
              You can change quantities or cancel for ten minutes, until the kitchen starts on
              the order.
            </p>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
            <button
              type="button"
              className="co__cta"
              onClick={save}
              disabled={pending || !dirty || remaining === 0}
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>

            {confirming ? null : (
              <button
                type="button"
                className="co__method"
                onClick={() => {
                  setConfirming(true);
                  setError('');
                  setNotice('');
                }}
                disabled={pending}
              >
                Cancel this order
              </button>
            )}
          </div>

          {confirming ? (
            <div className="cart__empty" role="group" aria-label="Confirm cancellation">
              <strong>
                Cancel all {lines.length === 1 ? 'of it' : `${lines.length} dishes`}?
              </strong>{' '}
              The kitchen is told immediately and this cannot be undone. Order again from the
              menu instead.
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
                <button type="button" className="co__cta" onClick={cancel} disabled={pending}>
                  {pending ? 'Cancelling…' : 'Yes, cancel it'}
                </button>
                <button
                  type="button"
                  className="co__method"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                >
                  Keep the order
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : lockedReason ? (
        <p className="cart__fine">{lockedReason}</p>
      ) : null}
    </>
  );
}
