'use client';

import { useMemo, useState, useTransition } from 'react';
import { counterQueue, inr, restaurant } from '@/lib/demo-data';
import type { CashierScreenData, CounterOrder } from '@/lib/db/cashier-screen';
import { recordPaymentAction } from '@/app/cashier/actions';
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
    items: order.items,
  };
}

/* ============================================================================
   Demo cashier

   The database is the source of truth whenever it is connected. Local state
   holds only the payment form (method, amount received) and a list of order
   ids to hide while their payment is being written; the queue itself is
   re-derived from props on every render, so a refresh from the server is
   always what the cashier ends up seeing.

   Nothing here collects a payment. recordPaymentAction writes a row to
   payments and settles the order, both inside one database transaction.
   ========================================================================== */
export function Cashier({ data }: { data?: CashierScreenData | null }) {
  const [method, setMethod] = useState<'cash' | 'card' | 'upi'>('cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [settling, setSettling] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const live = Boolean(data);
  const queue: QueueRow[] = live
    ? (data?.queue ?? []).map(fromLive)
    : counterQueue.map(fromDemo);

  // A row being paid vanishes immediately: the cashier has taken the money
  // and must not be able to take it twice by clicking again. If the write
  // fails the id comes back off this list and the row reappears with the
  // error shown.
  const visible = queue.filter((row) => !settling.includes(row.key));
  const order = visible[0];

  const received = Number(amountReceived);
  const change = order ? received - order.total : 0;
  const outstanding = useMemo(() => visible.reduce((sum, item) => sum + item.total, 0), [visible]);

  const recordPayment = () => {
    if (!order) return;
    setError('');
    setMessage('');

    if (!order.orderId) {
      setError('This queue is showing sample data. Connect the database to record real payments.');
      return;
    }
    if (!Number.isFinite(received) || received < 0) {
      setError('Enter a valid amount received.');
      return;
    }
    if (received < order.total) {
      setError(`Enter an amount at least equal to the total due (${inr(order.total)}).`);
      return;
    }

    const paidId = order.orderId;
    const paidCode = order.code;
    const changeDue = received - order.total;

    setSettling((current) => [...current, paidId]);

    startTransition(async () => {
      const result = await recordPaymentAction({
        orderId: paidId,
        method,
        amountReceived: received,
      });

      setSettling((current) => current.filter((id) => id !== paidId));

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setAmountReceived('');
      setMessage(
        changeDue > 0
          ? `Paid ${paidCode} via ${method.toUpperCase()}. Return ${inr(changeDue)} to the guest.`
          : `Paid ${paidCode} via ${method.toUpperCase()}. No change due.`
      );
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

      {data?.blocked && <SignInPrompt reason={data.blocked} screen="counter queue" />}

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
                    <strong className="tnum">{inr(item.total)}</strong>
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
                  {inr(order.total)}
                </h2>
              </div>
              <span className="cash__due">Payment due</span>
            </div>

            <ul className="cash__lines">
              <li>
                <span>{order.items}</span>
                <span className="tnum">{inr(order.total)}</span>
              </li>
            </ul>
            <div className="cash__totalRow">
              <span>Total due</span>
              <strong className="tnum">{inr(order.total)}</strong>
            </div>

            <div className="cash__methods" role="group" aria-label="Payment method">
              {(['cash', 'card', 'upi'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={`cash__method ${method === value ? 'is-on' : ''}`}
                  onClick={() => setMethod(value)}
                  aria-pressed={method === value}
                >
                  {value === 'cash' ? 'Cash' : value === 'card' ? 'Card' : 'UPI'}
                </button>
              ))}
            </div>

            <div className="cash__field">
              <label className="ui-label" htmlFor="amount-received">
                Amount received
              </label>
              <input
                className="ui-input tnum"
                id="amount-received"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                placeholder={String(Math.ceil(order.total))}
                value={amountReceived}
                onChange={(event) => setAmountReceived(event.target.value)}
              />
              <div className="ui-hint">
                {Number.isFinite(received) && received > 0 ? (
                  change >= 0 ? (
                    <>
                      Change to return: <strong>{inr(change)}</strong>
                    </>
                  ) : (
                    <>
                      Remaining: <strong>{inr(Math.abs(change))}</strong>
                    </>
                  )
                ) : (
                  <>Total due {inr(order.total)}</>
                )}
              </div>
            </div>

            {error && (
              <div className="pg__alert" role="alert">
                <strong>Could not record the payment.</strong>
                <p>{error}</p>
              </div>
            )}

            <button
              type="button"
              className="cash__cta"
              disabled={
                !Number.isFinite(received) ||
                received < order.total ||
                isPending
              }
              onClick={recordPayment}
            >
              {isPending ? 'Recording…' : `Record ${method.toUpperCase()} payment`}
            </button>
            {message && (
              <p className="cash__fine" role="status">
                {message}
              </p>
            )}
            <p className="cash__fine">
              {live
                ? 'Recorded against the database. Card and UPI entries are logged as counter payments; no provider is contacted.'
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
