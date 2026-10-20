'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { counterQueue, inr, restaurant } from '@/lib/demo-data';
import type { CashierScreenData, CounterOrder } from '@/lib/db/cashier-screen';
import { recordCashPaymentAction } from '@/app/cashier/actions';

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

   CASH ONLY. The database can store card and UPI payments, but the only
   function that takes money at the counter records cash. Rather than offer
   two buttons that would fail, they are shown and disabled, with the reason
   next to them -- an unimplemented feature has to look unimplemented.

   The amount is never typed in. record_cash_payment accepts exactly the
   outstanding balance and nothing else, so there is no "amount received" and
   no change to compute; the server works the figure out from the order and
   any payments already recorded against it.
   ========================================================================== */
export function Cashier({ data }: { data?: CashierScreenData | null }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [settling, setSettling] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  /**
   * One key per order in flight, reused if the same attempt is retried. Kept
   * in a ref rather than state: it is an implementation detail of talking to
   * the database, and changing it must never re-render the queue.
   */
  const keys = useRef<Record<string, string>>({});

  const live = Boolean(data);
  const queue: QueueRow[] = live
    ? (data?.queue ?? []).map(fromLive)
    : counterQueue.map(fromDemo);

  // A row being paid disappears at once: the cashier has the money in hand
  // and must not be able to take it twice. If the write fails the id comes
  // back off this list and the row returns with the error shown.
  const visible = queue.filter((row) => !settling.includes(row.key));
  const order = visible[0];
  const outstanding = useMemo(
    () => visible.reduce((sum, item) => sum + item.outstanding, 0),
    [visible]
  );

  const recordPayment = () => {
    if (!order) return;
    setError('');
    setMessage('');

    if (!order.orderId) {
      setError('This queue is showing sample data. Connect the database to record real payments.');
      return;
    }

    const paidId = order.orderId;

    // Reuse the key if this exact attempt failed before, so a retry is
    // recognised as a retry instead of starting a second payment.
    if (!keys.current[paidId]) keys.current[paidId] = newIdempotencyKey();

    setSettling((current) => [...current, paidId]);

    startTransition(async () => {
      const result = await recordCashPaymentAction({
        orderId: paidId,
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

  return (
    <div className="cash">
      <header className="cash__head">
        <div>
          <div className="cash__kicker">Cashier · {live ? 'live queue' : 'demo mode'}</div>
          <h1 className="cash__h1">{live ? data?.restaurantName : restaurant.name}</h1>
        </div>
        <div className="cash__headMeta">
          <span>{visible.length} orders awaiting counter payment</span>
          <span className="cash__outstanding">{inr(outstanding)} outstanding</span>
        </div>
      </header>

      <div className="cash__grid">
        <section>
          <h2 className="cash__h2">Awaiting payment</h2>
          {visible.length ? (
            <ul className="cash__queue">
              {visible.map((item, index) => (
                <li key={item.key} className={`cash__qItem ${index === 0 ? 'is-active' : ''}`}>
                  <div className="cash__qTop">
                    <strong>{item.code}</strong>
                    <span className="cash__qTable">{item.table}</span>
                    <span className="cash__qTime">{item.at}</span>
                  </div>
                  <div className="cash__qItems">{item.items}</div>
                  <div className="cash__qFoot">
                    <span className="cash__qState">{index === 0 ? 'Selected' : item.state}</span>
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
                  </div>
                </li>
              ))}
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
            <div className="cash__detailHead">
              <div>
                <div className="cash__kicker">
                  Order {order.code} · {order.table}
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
              <span className="cash__method is-on" aria-pressed="true">
                Cash
              </span>
              {/*
                Card and UPI are deliberately NOT wired up. public.record_cash_payment
                hardcodes method = 'cash'; there is no card or UPI counterpart in the
                database. Rendering them as live buttons would let a cashier record a
                payment the database refuses. They stay visible so the plan is honest
                about what exists, and disabled so nobody relies on them.
              */}
              {(['Card', 'UPI'] as const).map((label) => (
                <span
                  key={label}
                  className="cash__method"
                  aria-disabled="true"
                  title="Not enabled yet — only cash can be recorded at the counter"
                >
                  {label}
                </span>
              ))}
            </div>

            <p className="cash__fine">
              Only cash can be recorded at the counter right now. Card and UPI need a payment
              function in the database first — the button is not just unwired, the backend does
              not exist for it yet.
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
              disabled={isPending || !order.orderId}
              onClick={recordPayment}
            >
              {isPending ? 'Recording…' : `Take ${inr(order.outstanding)} in cash`}
            </button>
            {message && (
              <p className="cash__fine" role="status">
                {message}
              </p>
            )}
            <p className="cash__fine">
              {live
                ? 'Written to the database as a counter cash payment, with an audit entry. No card terminal or payment provider is contacted.'
                : 'Local preview only. Nothing is persisted and no payment is collected.'}
            </p>
          </section>
        ) : (
          <section className="cash__detail" aria-live="polite">
            <h2 className="cash__h2">Queue clear</h2>
            <p className="cash__fine">
              {live
                ? 'Every order from the last day has been settled.'
                : 'All demo orders have been marked paid in this browser session.'}
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
            {!live && (
              <button
                type="button"
                className="cash__cta"
                onClick={() => {
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
    </div>
  );
}
