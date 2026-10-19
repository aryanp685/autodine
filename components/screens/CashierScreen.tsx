'use client';

import { useState } from 'react';
import { counterQueue, inr, restaurant } from '@/lib/demo-data';

const RECEIPT_LINES = [
  { q: 1, name: 'Hyderabadi Chicken Biryani', note: 'Hot · Boondi raita', amount: 559 },
  { q: 3, name: 'Tandoori Roti', note: '', amount: 177 },
];

/* ============================================================================
   Editorial Minimal — locked design system cashier
   ========================================================================== */
export function Cashier() {
  const [method, setMethod] = useState<'cash' | 'card' | 'upi'>('cash');
  const order = counterQueue[0];
  const received = 1300;
  const change = received - order.total;

  return (
    <div className="cash">
      <header className="cash__head">
        <div>
          <div className="cash__kicker">Cashier</div>
          <h1 className="cash__h1">{restaurant.name}</h1>
        </div>
        <div className="cash__headMeta">
          <span>3 orders awaiting counter payment</span>
          <span className="cash__outstanding">{inr(2964)} outstanding</span>
        </div>
      </header>

      <div className="cash__grid">
        <section>
          <h2 className="cash__h2">Awaiting payment</h2>
          <ul className="cash__queue">
            {counterQueue.map((o) => (
              <li key={o.id} className={`cash__qItem ${o.id === order.id ? 'is-active' : ''}`}>
                <div className="cash__qTop">
                  <strong>{o.id}</strong>
                  <span className="cash__qTable">{o.table}</span>
                  <span className="cash__qTime">{o.at}</span>
                </div>
                <div className="cash__qItems">{o.items}</div>
                <div className="cash__qFoot">
                  <span className="cash__qState">{o.state}</span>
                  <strong className="tnum">{inr(o.total)}</strong>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="cash__detail">
          <div className="cash__detailHead">
            <div>
              <div className="cash__kicker">Order {order.id} · {order.table}</div>
              <h2 className="cash__amount">{inr(order.total)}</h2>
            </div>
            <span className="cash__due">Payment due</span>
          </div>

          <ul className="cash__lines">
            {RECEIPT_LINES.map((l) => (
              <li key={l.name}>
                <span>
                  <strong>{l.q} ×</strong> {l.name}
                  {l.note && <em> · {l.note}</em>}
                </span>
                <span className="tnum">{inr(l.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="cash__totalRow">
            <span>Total due</span>
            <strong className="tnum">{inr(order.total)}</strong>
          </div>

          <div className="cash__methods">
            {(['cash', 'card', 'upi'] as const).map((m) => (
              <button key={m} className={`cash__method ${method === m ? 'is-on' : ''}`} onClick={() => setMethod(m)}>
                {m === 'cash' ? 'Cash' : m === 'card' ? 'Card' : 'UPI'}
              </button>
            ))}
          </div>

          <div className="cash__field">
            <label className="ui-label">Amount received</label>
            <input className="ui-input tnum" defaultValue={received} />
            <div className="ui-hint">
              Change to return: <strong>{inr(change)}</strong>
            </div>
          </div>

          <button className="cash__cta">Record payment received</button>
          <p className="cash__fine">
            Recording payment creates an audited entry and turns the order into a paid receipt. Prototype —
            nothing is saved.
          </p>
        </section>
      </div>
    </div>
  );
}

