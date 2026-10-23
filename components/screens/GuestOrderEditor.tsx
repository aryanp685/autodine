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
      <div className="flex flex-col gap-2.5">
        {lines.map((l) => {
          const now = qty[l.id] ?? l.qty;
          const removed = canEdit && now === 0;

          return (
            <div
              key={l.id}
              className={[
                'g-card flex items-center gap-3 p-3',
                removed ? 'g-void' : '',
              ].join(' ')}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 items-center gap-1.5">
                  <VegMark veg={l.isVeg} />
                  <strong
                    className={[
                      'truncate text-[14.5px] font-semibold text-gink',
                      removed ? 'line-through decoration-gink-28' : '',
                    ].join(' ')}
                  >
                    {l.name}
                  </strong>
                  {l.variantName ? <em className="text-[12.5px] text-gink-46 not-italic"> · {l.variantName}</em> : null}
                </div>
                {l.addons.length > 0 ? (
                  <div className="mt-0.5 text-[12px] leading-[1.45] text-gink-64">+ {l.addons.join(', ')}</div>
                ) : null}
                <div className="tnum mt-0.5 text-[12.5px] text-gink-46">
                  {inr(paiseToRupees(l.unitPricePaise))} each
                  {removed ? ' · will be removed' : ''}
                </div>
              </div>

              {canEdit ? (
                <div className="g-quiet flex shrink-0 items-center rounded-full">
                  <button
                    type="button"
                    onClick={() => step(l, -1)}
                    disabled={pending || now === 0}
                    aria-label={`One fewer ${l.name}`}
                    className="grid size-7 place-items-center rounded-full text-[14px] text-gink-80 transition hover:bg-gink-07 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="tnum min-w-5 text-center text-[12.5px] font-semibold text-gink">{now}</span>
                  <button
                    type="button"
                    onClick={() => step(l, +1)}
                    disabled={pending || now >= 99}
                    aria-label={`One more ${l.name}`}
                    className="grid size-7 place-items-center rounded-full text-[14px] text-gink-80 transition hover:bg-gink-07 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="tnum shrink-0 text-[13px] font-semibold text-gink-64">{l.qty}</span>
              )}

              <span className="tnum w-16 shrink-0 text-right text-[13.5px] font-semibold text-gink">
                {removed ? '—' : inr(paiseToRupees(l.unitPricePaise * now))}
              </span>
            </div>
          );
        })}
      </div>

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="mt-2 text-[12.5px] leading-[1.5] text-[var(--alert)]">
            {error}
          </p>
        ) : null}
        {notice ? <p className="mt-2 text-[12.5px] leading-[1.5] text-gink-64">{notice}</p> : null}
      </div>

      {canEdit ? (
        <div className="mt-3">
          {dirty ? (
            <p className="text-[12px] leading-[1.55] text-gink-64">
              New subtotal {inr(paiseToRupees(nextSubtotal))}
              {nextSubtotal !== subtotalPaise ? ` (was ${inr(paiseToRupees(subtotalPaise))})` : ''}
              . Taxes and the total are recalculated when you save.
              {remaining === 0 ? ' At least one dish has to stay on the order.' : ''}
            </p>
          ) : (
            <p className="text-[12px] leading-[1.55] text-gink-46">
              You can change quantities or cancel for ten minutes, until the kitchen starts on
              the order.
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty || remaining === 0}
              className="g-primary h-10 rounded-full px-4 text-[12.5px] font-semibold"
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>

            {confirming ? null : (
              <button
                type="button"
                onClick={() => {
                  setConfirming(true);
                  setError('');
                  setNotice('');
                }}
                disabled={pending}
                className="g-quiet h-10 rounded-full px-4 text-[12.5px] font-semibold text-[var(--alert)] disabled:opacity-40"
              >
                Cancel this order
              </button>
            )}
          </div>

          {confirming ? (
            <div
              role="group"
              aria-label="Confirm cancellation"
              className="mt-2.5 rounded-2xl border border-[var(--alert)]/25 bg-[var(--alert)]/6 px-4 py-3.5"
            >
              <strong className="text-[13.5px] font-semibold text-gink">
                Cancel all {lines.length === 1 ? 'of it' : `${lines.length} dishes`}?
              </strong>{' '}
              <span className="text-[12.5px] leading-[1.55] text-gink-64">
                The kitchen is told immediately and this cannot be undone. Order again from the
                menu instead.
              </span>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  disabled={pending}
                  className="h-10 rounded-full bg-[var(--alert)] px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
                >
                  {pending ? 'Cancelling…' : 'Yes, cancel it'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="h-10 rounded-full border border-hair-strong px-4 text-[12.5px] font-semibold text-gink disabled:opacity-50"
                >
                  Keep the order
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : lockedReason ? (
        <p className="mt-3 text-[12px] leading-[1.55] text-gink-46">{lockedReason}</p>
      ) : null}
    </>
  );
}
