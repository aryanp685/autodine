'use client';

import { useMemo, useState } from 'react';
import { counterQueue, inr, restaurant } from '@/lib/demo-data';

/* Demo cashier: state is local to this browser tab and is never persisted. */
export function Cashier() {
  const [method, setMethod] = useState<'cash' | 'card' | 'upi'>('cash');
  const [queue, setQueue] = useState(() => counterQueue.map((order) => ({ ...order })));
  const [amountReceived, setAmountReceived] = useState('1300');
  const [message, setMessage] = useState('');
  const order = queue[0];
  const received = Number(amountReceived);
  const change = order ? received - order.total : 0;
  const outstanding = useMemo(() => queue.reduce((sum, item) => sum + item.total, 0), [queue]);

  const recordPayment = () => {
    if (!order || !Number.isSafeInteger(received) || received < order.total) {
      setMessage('Enter an amount at least equal to the total due.');
      return;
    }
    setMessage(`Demo payment recorded for ${order.id} via ${method.toUpperCase()}. This was not saved.`);
    setQueue((current) => current.slice(1));
    setAmountReceived('1300');
  };

  return (
    <div className="cash">
      <header className="cash__head">
        <div>
          <div className="cash__kicker">Demo — not saved</div>
          <h1 className="cash__h1">{restaurant.name}</h1>
        </div>
        <div className="cash__headMeta">
          <span>{queue.length} orders awaiting counter payment</span>
          <span className="cash__outstanding">{inr(outstanding)} outstanding</span>
        </div>
      </header>

      <div className="cash__grid">
        <section>
          <h2 className="cash__h2">Awaiting payment</h2>
          {queue.length ? (
            <ul className="cash__queue">
              {queue.map((item, index) => (
                <li key={item.id} className={`cash__qItem ${index === 0 ? 'is-active' : ''}`}>
                  <div className="cash__qTop">
                    <strong>{item.id}</strong>
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
            <p className="cash__fine">No demo orders are waiting for payment.</p>
          )}
        </section>

        {order ? (
          <section className="cash__detail" aria-labelledby="cashier-order-title">
            <div className="cash__detailHead">
              <div>
                <div className="cash__kicker">Order {order.id} · {order.table}</div>
                <h2 className="cash__amount" id="cashier-order-title">{inr(order.total)}</h2>
              </div>
              <span className="cash__due">Payment due</span>
            </div>

            <ul className="cash__lines">
              <li><span>{order.items}</span><span className="tnum">{inr(order.total)}</span></li>
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
              <label className="ui-label" htmlFor="amount-received">Amount received</label>
              <input
                className="ui-input tnum"
                id="amount-received"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={amountReceived}
                onChange={(event) => setAmountReceived(event.target.value)}
              />
              <div className="ui-hint">
                {change >= 0 ? <>Change to return: <strong>{inr(change)}</strong></> : <>Remaining: <strong>{inr(Math.abs(change))}</strong></>}
              </div>
            </div>

            <button type="button" className="cash__cta" disabled={received < order.total || !Number.isSafeInteger(received)} onClick={recordPayment}>
              Record demo payment
            </button>
            {message && <p className="cash__fine" role="status">{message}</p>}
            <p className="cash__fine">Local preview only. Nothing is persisted and no payment is collected.</p>
          </section>
        ) : (
          <section className="cash__detail" aria-live="polite">
            <h2 className="cash__h2">Queue clear</h2>
            <p className="cash__fine">All demo orders have been marked paid in this browser session.</p>
            {message && <p className="cash__fine" role="status">{message}</p>}
            <button type="button" className="cash__cta" onClick={() => { setQueue(counterQueue.map((item) => ({ ...item }))); setMessage('Demo queue reset. No real payments were recorded.'); }}>
              Reset demo queue
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
