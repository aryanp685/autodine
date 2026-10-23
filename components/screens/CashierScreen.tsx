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

  return (
    <div className="pg pg--dash app" data-surface="owner">
      {nav}

      <main className="cash">
        <header className="cash__head">
          <div>
            <div className="cash__kicker">
              {live ? 'Counter · open' : 'Counter · demo mode'}
            </div>
            <h1 className="cash__h1">
              {blocked ? 'The counter' : live ? data?.restaurantName : restaurant.name}
            </h1>
          </div>
          {!blocked && (
            <div className="cash__headMeta">
              <span>
                <strong className="tnum">{visible.length}</strong>{' '}
                {visible.length === 1 ? 'ticket' : 'tickets'} awaiting payment
              </span>
              <span className="cash__outstanding">
                {inr(outstanding)} <em>outstanding</em>
              </span>
            </div>
          )}
        </header>

        {blocked && <SignInPrompt reason={blocked} screen="counter" />}

        {!blocked && (
          <div className="cash__grid">
            <section className="cash__col">
              <h2 className="cash__h2">Awaiting payment</h2>
              {visible.length ? (
                <ul className="cash__queue">
                  {visible.map((item) => {
                    const selected = order?.key === item.key;
                    return (
                      <li key={item.key} className={`cash__qItem ${selected ? 'is-active' : ''}`}>
                        <button
                          type="button"
                          className="cash__qBtn"
                          aria-pressed={selected}
                          aria-label={`Select ${item.code} at ${item.table}, ${inr(item.outstanding)} outstanding`}
                          onClick={() => {
                            setSelectedKey(item.key);
                            setConfirmCancel(null);
                            setError('');
                          }}
                        >
                          <span className="cash__qTop">
                            <strong>{item.code}</strong>
                            <span className="cash__qTable">{item.table}</span>
                            <span className="cash__qTime">{item.at}</span>
                          </span>
                          <span className="cash__qItems">{item.items}</span>
                          <span className="cash__qFoot">
                            <span className="cash__qState">
                              {selected ? <span className="cash__qSel">Selected</span> : null}
                              {item.state}
                            </span>
                            <strong className="tnum">
                              {/* Outstanding, not total: what the till actually wants. */}
                              {inr(item.outstanding)}
                              {item.paid > 0 && (
                                <em style={{ fontStyle: 'normal', opacity: 0.6 }}>
                                  {' '}
                                  of {inr(item.total)}
                                </em>
                              )}
                            </strong>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="cash__fine">
                  {live
                    ? 'No orders are waiting for payment.'
                    : 'No demo orders are waiting for payment.'}
                </p>
              )}
            </section>

            {order ? (
              <section className="cash__detail" aria-labelledby="cashier-order-title">
                {focusMissing ? (
                  <div className="cash__focus" role="status">
                    <p>
                      The bill you came for is not waiting any more — it was settled or cancelled
                      just now. This is the oldest ticket still open.
                    </p>
                    <button
                      type="button"
                      className="pg__miniBtn"
                      onClick={() => {
                        setFocusDismissed(true);
                        setSelectedKey(null);
                      }}
                    >
                      Got it
                    </button>
                  </div>
                ) : null}
                <div className="cash__detailHead">
                  <div>
                    <div className="cash__kicker">
                      Order {order.code} · {order.table}
                      {order.orderId ? (
                        <>
                          {' · '}
                          <Link href={`/bill/${order.orderId}`}>bill</Link>
                        </>
                      ) : null}
                    </div>
                    <h2 className="cash__amount" id="cashier-order-title">
                      {inr(order.outstanding)}
                    </h2>
                  </div>
                  <span className="cash__due">Payment due</span>
                </div>

                {order.paid > 0 && (
                  <p className="cash__fine">
                    {inr(order.paid)} already recorded on this order, against a bill of{' '}
                    {inr(order.total)}. Take the remaining {inr(order.outstanding)}.
                  </p>
                )}

                <ul className="cash__lines">
                  <li>
                    <span>{order.items}</span>
                    <span className="tnum">{inr(order.total)}</span>
                  </li>
                </ul>
                <div className="cash__totalRow">
                  <span>Outstanding</span>
                  <strong className="tnum">{inr(order.outstanding)}</strong>
                </div>

                <div className="cash__methods" role="group" aria-label="Payment method">
                  {COUNTER_METHODS.map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={`cash__method ${method === value ? 'is-on' : ''}`}
                      onClick={() => setMethod(value)}
                      aria-pressed={method === value}
                    >
                      {COUNTER_METHOD_LABEL[value]}
                    </button>
                  ))}
                </div>

                <p className="cash__fine">
                  Recorded as a counter {method === 'cash' ? 'cash' : method.toUpperCase()} payment.
                  Nothing is charged here — the guest pays on a terminal or by scanning a code, and
                  this only writes the record.
                </p>

                {error && (
                  <div className="pg__alert" role="alert">
                    <strong>Could not record the payment.</strong>
                    <p>{error}</p>
                  </div>
                )}

                <button
                  type="button"
                  className="cash__cta"
                  disabled={isPending || (live && !order.orderId)}
                  onClick={recordPayment}
                >
                  {isPending
                    ? 'Recording…'
                    : `Record ${method === 'cash' ? 'cash' : method.toUpperCase()} ${inr(order.outstanding)}`}
                </button>

                {confirmCancel === order.orderId && order.orderId ? (
                  <div className="cash__confirm" role="group" aria-label="Confirm cancellation">
                    <strong>
                      Cancel {order.code} for {order.table}?
                    </strong>
                    <p>
                      Nothing is charged. The kitchen is told at once and the ticket leaves this
                      queue — this cannot be undone.
                    </p>
                    <div className="cash__confirmActions">
                      <button
                        type="button"
                        className="pg__miniBtn pg__miniBtn--danger"
                        disabled={cancelling === order.orderId}
                        onClick={cancelOrder}
                      >
                        {cancelling === order.orderId ? 'Cancelling…' : 'Yes, cancel it'}
                      </button>
                      <button
                        type="button"
                        className="pg__miniBtn"
                        onClick={() => setConfirmCancel(null)}
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="cash__cancel"
                    disabled={isPending || (live && !order.orderId)}
                    onClick={cancelOrder}
                  >
                    Cancel this order
                  </button>
                )}

                {message && (
                  <p className="cash__fine" role="status">
                    {message}
                  </p>
                )}
                <p className="cash__fine">
                  {live
                    ? 'Written to the database with an audit entry. No card terminal or payment provider is contacted — this is a record, not a charge.'
                    : 'Preview only. Nothing is persisted, nothing is charged, and the queue is reset by reloading this page.'}
                </p>
              </section>
            ) : (
              <section className="cash__detail" aria-live="polite">
                <h2 className="cash__h2">Queue clear</h2>
                <p className="cash__fine">
                  {live
                    ? 'Every order from the last day has been settled.'
                    : 'Every demo order in this preview has been settled.'}
                </p>
                {message && (
                  <p className="cash__fine" role="status">
                    {message}
                  </p>
                )}
                {error && (
                  <div className="pg__alert" role="alert">
                    <p>{error}</p>
                  </div>
                )}
                {!live && demoDone.length > 0 && (
                  <button
                    type="button"
                    className="cash__cta"
                    onClick={() => {
                      setDemoDone([]);
                      setSettling([]);
                      setMessage('Demo queue reset. No real payments were recorded.');
                    }}
                  >
                    Reset demo queue
                  </button>
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
