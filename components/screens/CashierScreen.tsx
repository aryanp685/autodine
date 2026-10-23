'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { counterQueue, inr, restaurant } from '@/lib/demo-data';
import type { CashierScreenData, CounterOrder } from '@/lib/db/cashier-screen';
// Value import, so it comes from the database-free module. Importing
// COUNTER_METHODS from lib/db/cashier-screen would pull lib/supabase/server
// into the browser bundle -- type-only imports there are fine, this is not.
import { COUNTER_METHODS, COUNTER_METHOD_LABEL, type CounterMethod } from '@/lib/payment-methods';
import { recordPaymentAction } from '@/app/cashier/actions';
import { cancelStaffOrderAction } from '@/app/orders/actions';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  PageHead,
  SectionHead,
  Card,
  Panel,
  BtnLink,
  btn,
  Dot,
  Tag,
  Empty,
} from '@/components/owner/chrome';

/** One row in the queue, in the shape the locked markup renders. */
type QueueRow = {
  key: string;
  /** Database UUID. Absent on demo rows, which therefore cannot be paid. */
  orderId?: string;
  code: string;
  table: string;
  at: string;
  state: string;
  total: number;
  outstanding: number;
  paid: number;
  items: string;
};

function fromDemo(order: (typeof counterQueue)[number]): QueueRow {
  return {
    key: order.id,
    code: order.id,
    table: order.table,
    at: order.at,
    state: order.state,
    total: order.total,
    // Demo rows are never partly paid, so everything is still owed.
    outstanding: order.total,
    paid: 0,
    items: order.items,
  };
}

function fromLive(order: CounterOrder): QueueRow {
  return {
    key: order.id ?? order.code,
    orderId: order.id,
    code: order.code,
    table: order.table,
    at: order.at,
    state: order.state,
    total: order.total,
    outstanding: order.outstanding,
    paid: order.paid,
    items: order.items,
  };
}

/**
 * Random UUID, with a fallback for browsers that gate crypto.randomUUID to
 * secure contexts. The key only needs to be unique per attempt, not
 * cryptographic -- its job is to let the database recognise a retry, not to
 * be unguessable. Any collision would have to happen between two attempts on
 * the same order within seconds.
 */
function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/* ============================================================================
   Counter / cashier

   Cash, card and UPI. All three go through one database function,
   record_counter_payment (migration 0004). None of them process anything:
   the guest pays on a terminal or by scanning a code, and this screen records
   that it happened. No provider is contacted.

   The amount is never typed in. The function accepts exactly the outstanding
   balance and nothing else, so there is no "amount received" and no change to
   compute -- the server works the figure out from the order and any payments
   already recorded against it.

   THREE THINGS THIS SCREEN COULD NOT DO, NOW FIXED

   1. It could not be left. The counter rendered no navigation at all -- no
      bar, no sign-out, no way back to the dashboard -- so a cashier's only
      exit was the browser's back button. The bar is now rendered by the
      server page and passed in as `nav`: this component is a Client
      Component, and the sign-out form inside the bar is a server action, so
      it cannot be imported from here without dragging server-only modules
      into the browser bundle.

   2. The cashier could not choose a ticket. `order` was `visible[0]`, full
      stop, so the queue could only ever be settled oldest-first. With a guest
      at the counter holding order #4 of six, there was nothing to press.

   3. In demo mode the settle button was disabled and said nothing about why:
      demo rows have no database id, so a preview queue could never be
      cleared. The preview now settles locally, says that it recorded
      nothing, and the reset button brings the queue back -- the same honesty
      the kitchen board uses for its sample tickets.

   And a fourth, quieter one: `data.blocked` was returned by the loader and
   never rendered, so a signed-out visitor saw an empty counter and no
   explanation. That is what "the restaurant has no orders" looks like.
   ========================================================================== */
export function Cashier({
  data,
  nav,
  focus,
}: {
  data?: CashierScreenData | null;
  /** The shared app bar, rendered by the server page. */
  nav?: ReactNode;
  /**
   * The bill the ledger asked for, from `?order=`.
   *
   * The order ledger and the counter are the same queue seen twice: a row with
   * money due says "Collect", and that has to land on THAT ticket rather than
   * on whichever one happens to be oldest.
   */
  focus?: string;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<CounterMethod>('cash');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [settling, setSettling] = useState<string[]>([]);
  /** Orders settled or cancelled locally, in demo mode only. */
  const [demoDone, setDemoDone] = useState<string[]>([]);
  /** Which ticket the cashier is looking at. Null means "the oldest one". */
  const [selectedKey, setSelectedKey] = useState<string | null>(focus?.trim() || null);
  /** Has the cashier dismissed the note about a bill that is no longer waiting? */
  const [focusDismissed, setFocusDismissed] = useState(false);
  /** The order the cashier has asked to cancel, before they confirm. */
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * One key per order in flight, reused if the same attempt is retried. Kept
   * in a ref rather than state: it is an implementation detail of talking to
   * the database, and changing it must never re-render the queue.
   */
  const keys = useRef<Record<string, string>>({});

  const live = Boolean(data);
  const blocked = data?.blocked;
  const queue: QueueRow[] = live
    ? (data?.queue ?? []).map(fromLive)
    : counterQueue
        .map(fromDemo)
        .filter((row) => !demoDone.includes(row.key));

  // A row being paid disappears at once: the cashier has the money in hand
  // and must not be able to take it twice. If the write fails the id comes
  // back off this list and the row returns with the error shown.
  const visible = queue.filter((row) => !settling.includes(row.key));
  // The selection follows the queue: when the chosen ticket is settled it
  // leaves, and the panel falls back to the oldest one still waiting, which
  // is where a cashier's attention goes next anyway.
  const order = visible.find((row) => row.key === selectedKey) ?? visible[0];
  /**
   * A bill can leave the queue between the ledger being drawn and the tap:
   * somebody at the counter settles it, or the kitchen cancels it.
   *
   * The panel still has to show something, so it falls back to the oldest
   * ticket -- but silently, that would look like the link went to the wrong
   * order, and at a real counter it could mean taking the wrong table's money.
   * So the fallback says out loud that it is a fallback.
   */
  const wanted = focus?.trim() || null;
  const focusMissing = Boolean(
    wanted &&
      !focusDismissed &&
      !visible.some((row) => row.key === wanted || row.code === wanted),
  );
  const outstanding = useMemo(
    () => visible.reduce((sum, item) => sum + item.outstanding, 0),
    [visible],
  );

  const recordPayment = () => {
    if (!order) return;
    setError('');
    setMessage('');

    // No database row means nothing can be written. In a preview that is
    // expected, so the row is settled in this browser only and the screen
    // says exactly that -- a disabled button with no explanation is how a
    // demo reads as broken.
    if (!order.orderId) {
      if (!live) {
        setDemoDone((current) => [...current, order.key]);
        setMessage(
          `${order.code} marked paid in this preview. Nothing was recorded and no money changed hands.`,
        );
        return;
      }
      setError('This ticket has no database id, so a payment cannot be recorded against it.');
      return;
    }

    const paidId = order.orderId;

    // Reuse the key if this exact attempt failed before, so a retry is
    // recognised as a retry instead of starting a second payment.
    if (!keys.current[paidId]) keys.current[paidId] = newIdempotencyKey();

    setSettling((current) => [...current, paidId]);

    startTransition(async () => {
      const result = await recordPaymentAction({
        orderId: paidId,
        method,
        idempotencyKey: keys.current[paidId],
      });

      if (!result.ok) {
        setSettling((current) => current.filter((id) => id !== paidId));
        setError(result.error);
        return;
      }

      // Success: the key has done its job, so the next order gets a fresh one.
      delete keys.current[paidId];
      setSettling((current) => current.filter((id) => id !== paidId));
      setMessage(result.message);
    });
  };

  /**
   * Cancel the selected order.
   *
   * Two taps, and the confirmation names what is being cancelled: at a busy
   * counter "Cancel" next to "Record cash" is one slip away from throwing
   * away a guest's order.
   *
   * The row leaves the queue immediately and the server is re-read, because a
   * cancelled order must not be settleable -- taking money for food that will
   * never arrive is the worst outcome this screen can produce.
   */
  const cancelOrder = async () => {
    if (!order) return;

    if (!order.orderId) {
      if (!live) {
        setDemoDone((current) => [...current, order.key]);
        setConfirmCancel(null);
        setMessage(`${order.code} cancelled in this preview. Nothing was recorded.`);
        return;
      }
      setError('This ticket has no database id, so it cannot be cancelled here.');
      return;
    }

    const id = order.orderId;

    if (confirmCancel !== id) {
      setConfirmCancel(id);
      return;
    }

    setError('');
    setMessage('');
    setCancelling(id);

    const result = await cancelStaffOrderAction({ orderId: id });

    setCancelling(null);
    setConfirmCancel(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSettling((current) => [...current, id]);
    setMessage(result.message);
    router.refresh();
  };

  const outstandingNote =
    visible.length === 1 ? '1 ticket awaiting payment' : `${visible.length} tickets awaiting payment`;

  return (
    <div data-surface="owner" className="min-h-dvh bg-paper text-gink antialiased">
      {nav}

      <div className="lg:pl-[232px]">
        <main className="mx-auto w-full max-w-[1180px] px-5 pt-6 pb-20 sm:px-7 lg:pt-9">
          <PageHead
            kicker={
              <span className="inline-flex items-center gap-1.5">
                <Dot tone={live ? 'live' : 'idle'} />
                {live ? 'Counter · open' : 'Counter · demo mode'}
              </span>
            }
            title={blocked ? 'The counter' : live ? data?.restaurantName || 'This restaurant' : restaurant.name}
            meta={
              blocked ? (
                'Payments can only be recorded by a signed-in member of staff.'
              ) : (
                <>
                  {outstandingNote}
                  <span className="mx-2 text-gink-28">·</span>
                  <span className="text-gink tabular-nums">{inr(outstanding)}</span> outstanding
                </>
              )
            }
            actions={
              !blocked ? (
                <BtnLink href="/dashboard/orders" tone="ghost" size="sm">
                  The ledger
                </BtnLink>
              ) : null
            }
          />

          {blocked && <SignInPrompt reason={blocked} screen="counter" />}

          {!blocked && (
            <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-start lg:gap-6">
              {/* -------------------------------------------------------- queue */}
              <section aria-labelledby="counter-queue">
                <SectionHead
                  title={<span id="counter-queue">Awaiting payment</span>}
                  meta={visible.length ? `${visible.length} open` : 'clear'}
                />
                {visible.length ? (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0" data-counter-queue>
                    {visible.map((item) => {
                      const selected = order?.key === item.key;
                      return (
                        <li key={item.key}>
                          <button
                            type="button"
                            data-counter-ticket
                            data-selected={selected ? 'true' : 'false'}
                            aria-pressed={selected}
                            aria-label={`Select ${item.code} at ${item.table}, ${inr(item.outstanding)} outstanding`}
                            onClick={() => {
                              setSelectedKey(item.key);
                              setConfirmCancel(null);
                              setError('');
                            }}
                            className={[
                              'w-full rounded-[14px] border px-4 py-3 text-left transition-[border-color,background-color,box-shadow] duration-150',
                              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gink',
                              selected
                                ? 'border-gink bg-card shadow-[0_1px_0_var(--hair)]'
                                : 'border-hair bg-card hover:border-hair-strong hover:bg-paper-deep',
                            ].join(' ')}
                          >
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="flex items-baseline gap-2">
                                <strong className="text-[14px] font-semibold tracking-[-0.01em] text-gink">
                                  {item.code}
                                </strong>
                                <span className="text-[12px] text-gink-46">{item.table}</span>
                              </span>
                              <span className="text-[11.5px] text-gink-46 tabular-nums">{item.at}</span>
                            </span>

                            <span className="mt-1.5 block truncate text-[12.5px] leading-[1.45] text-gink-64">
                              {item.items}
                            </span>

                            <span className="mt-2.5 flex items-baseline justify-between gap-3">
                              <span className="flex items-center gap-2">
                                {selected ? <Tag tone="ink">Selected</Tag> : null}
                                <span className="text-[11.5px] text-gink-46">{item.state}</span>
                              </span>
                              <span className="text-[13.5px] font-medium text-gink tabular-nums">
                                {/* Outstanding, not total: what the till actually wants. */}
                                {inr(item.outstanding)}
                                {item.paid > 0 && (
                                  <span className="ml-1 text-[11.5px] font-normal text-gink-46">
                                    of {inr(item.total)}
                                  </span>
                                )}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Empty>
                    {live
                      ? 'No orders are waiting for payment.'
                      : 'No demo orders are waiting for payment.'}
                  </Empty>
                )}
              </section>

              {/* ------------------------------------------------------- detail */}
              {order ? (
                <section aria-labelledby="cashier-order-title" className="min-w-0">
                  {focusMissing ? (
                    <div
                      role="status"
                      className="mb-3 flex flex-wrap items-baseline justify-between gap-3 rounded-[12px] border border-hair-strong bg-paper-deep px-4 py-3"
                    >
                      <p className="m-0 max-w-[54ch] text-[12.5px] leading-[1.5] text-gink-64">
                        The bill you came for is not waiting any more — it was settled or cancelled
                        just now. This is the oldest ticket still open.
                      </p>
                      <button
                        type="button"
                        className={btn('ghost', 'sm')}
                        onClick={() => {
                          setFocusDismissed(true);
                          setSelectedKey(null);
                        }}
                      >
                        Got it
                      </button>
                    </div>
                  ) : null}

                  <Card>
                    {/* the amount is the one large thing on this screen */}
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hair px-5 py-5">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium tracking-[0.03em] text-gink-46">
                          Order {order.code} · {order.table}
                          {order.orderId ? (
                            <>
                              {' · '}
                              <Link
                                href={`/bill/${order.orderId}`}
                                className="text-gink underline decoration-hair-strong underline-offset-2 hover:decoration-gink"
                              >
                                bill
                              </Link>
                            </>
                          ) : null}
                        </div>
                        <h2
                          id="cashier-order-title"
                          className="mt-1.5 text-[clamp(2rem,3.4vw,2.6rem)] leading-none font-medium tracking-[-0.045em] text-gink tabular-nums"
                        >
                          {inr(order.outstanding)}
                        </h2>
                      </div>
                      <Tag tone="due">Payment due</Tag>
                    </div>

                    <div className="px-5 py-4">
                      {order.paid > 0 && (
                        <p className="mb-3 text-[12.5px] leading-[1.5] text-gink-64">
                          {inr(order.paid)} already recorded on this order, against a bill of{' '}
                          {inr(order.total)}. Take the remaining {inr(order.outstanding)}.
                        </p>
                      )}

                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        <li className="flex items-baseline justify-between gap-4 text-[13px] text-gink-64">
                          <span className="min-w-0">{order.items}</span>
                          <span className="shrink-0 tabular-nums">{inr(order.total)}</span>
                        </li>
                      </ul>
                      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-hair pt-3 text-[13px]">
                        <span className="font-medium text-gink">Outstanding</span>
                        <strong className="tabular-nums text-gink">{inr(order.outstanding)}</strong>
                      </div>

                      <div className="mt-5">
                        <div className="mb-2 text-[11.5px] font-medium text-gink-64">Payment method</div>
                        <div
                          role="group"
                          aria-label="Payment method"
                          className="inline-flex rounded-full border border-hair-strong bg-paper-deep p-0.5"
                        >
                          {COUNTER_METHODS.map((value) => (
                            <button
                              type="button"
                              key={value}
                              aria-pressed={method === value}
                              onClick={() => setMethod(value)}
                              className={[
                                'h-8 rounded-full px-3.5 text-[12px] font-medium transition-colors duration-150',
                                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gink',
                                method === value
                                  ? 'bg-gink text-onink'
                                  : 'text-gink-64 hover:text-gink',
                              ].join(' ')}
                            >
                              {COUNTER_METHOD_LABEL[value]}
                            </button>
                          ))}
                        </div>
                      </div>

                      <p className="mt-4 text-[11.5px] leading-[1.5] text-gink-46">
                        Recorded as a counter {method === 'cash' ? 'cash' : method.toUpperCase()}{' '}
                        payment. Nothing is charged here — the guest pays on a terminal or by
                        scanning a code, and this only writes the record.
                      </p>

                      {error && (
                        <div
                          role="alert"
                          className="mt-3 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-3"
                        >
                          <strong className="text-[12.5px] text-[var(--alert)]">
                            Could not record the payment.
                          </strong>
                          <p className="mt-1 text-[12px] leading-[1.5] text-gink-64">{error}</p>
                        </div>
                      )}

                      <button
                        type="button"
                        data-counter-cta
                        className={`${btn('solid')} mt-4 w-full`}
                        disabled={isPending || Boolean(live && !order.orderId)}
                        onClick={recordPayment}
                      >
                        {isPending
                          ? 'Recording…'
                          : `Record ${method === 'cash' ? 'cash' : method.toUpperCase()} ${inr(order.outstanding)}`}
                      </button>

                      {confirmCancel === order.orderId && order.orderId ? (
                        <div
                          role="group"
                          aria-label="Confirm cancellation"
                          className="mt-3 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/6 px-3.5 py-3"
                        >
                          <strong className="text-[12.5px] text-gink">
                            Cancel {order.code} for {order.table}?
                          </strong>
                          <p className="mt-1 text-[12px] leading-[1.5] text-gink-64">
                            Nothing is charged. The kitchen is told at once and the ticket leaves
                            this queue — this cannot be undone.
                          </p>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={btn('danger', 'sm')}
                              disabled={cancelling === order.orderId}
                              onClick={cancelOrder}
                            >
                              {cancelling === order.orderId ? 'Cancelling…' : 'Yes, cancel it'}
                            </button>
                            <button
                              type="button"
                              className={btn('ghost', 'sm')}
                              onClick={() => setConfirmCancel(null)}
                            >
                              Keep it
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`${btn('quiet', 'sm')} mt-1`}
                          disabled={isPending || Boolean(live && !order.orderId)}
                          onClick={cancelOrder}
                        >
                          Cancel this order
                        </button>
                      )}

                      {message && (
                        <p
                          role="status"
                          className="mt-3 rounded-[10px] border border-hair bg-paper-deep px-3.5 py-2.5 text-[12px] leading-[1.5] text-gink-64"
                        >
                          {message}
                        </p>
                      )}
                      <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                        {live
                          ? 'Written to the database with an audit entry. No card terminal or payment provider is contacted — this is a record, not a charge.'
                          : 'Preview only. Nothing is persisted, nothing is charged, and the queue is reset by reloading this page.'}
                      </p>
                    </div>
                  </Card>
                </section>
              ) : (
                <section aria-live="polite" className="min-w-0">
                  <Panel title="Queue clear" meta={live ? 'all settled' : 'preview'}>
                    <p className="m-0 text-[13px] leading-[1.55] text-gink-64">
                      {live
                        ? 'Every order from the last day has been settled.'
                        : 'Every demo order in this preview has been settled.'}
                    </p>
                    {message && (
                      <p role="status" className="mt-3 text-[12px] leading-[1.5] text-gink-64">
                        {message}
                      </p>
                    )}
                    {error && (
                      <div
                        role="alert"
                        className="mt-3 rounded-[10px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-3 text-[12px] text-[var(--alert)]"
                      >
                        {error}
                      </div>
                    )}
                    {!live && demoDone.length > 0 && (
                      <button
                        type="button"
                        className={`${btn('ghost')} mt-4`}
                        onClick={() => {
                          setDemoDone([]);
                          setSettling([]);
                          setMessage('Demo queue reset. No real payments were recorded.');
                        }}
                      >
                        Reset demo queue
                      </button>
                    )}
                  </Panel>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
