'use client';

import { useState } from 'react';
import { counterQueue, inr, restaurant } from '@/lib/demo-data';
import { QrChip } from '@/components/ui';

const RECEIPT_LINES = [
  { q: 1, name: 'Hyderabadi Chicken Biryani', note: 'Hot · Boondi raita', amount: 559 },
  { q: 3, name: 'Tandoori Roti', note: '', amount: 177 },
];

/* ============================================================================
   Option A — Editorial Minimal cashier
   ========================================================================== */
export function CashierA() {
  const [method, setMethod] = useState<'cash' | 'card' | 'upi'>('cash');
  const order = counterQueue[0];
  const received = 1300;
  const change = received - order.total;

  return (
    <div className="a-cash">
      <header className="a-cash__head">
        <div>
          <div className="a-cash__kicker">Cashier</div>
          <h1 className="a-cash__h1">{restaurant.name}</h1>
        </div>
        <div className="a-cash__headMeta">
          <span>3 orders awaiting counter payment</span>
          <span className="a-cash__outstanding">{inr(2964)} outstanding</span>
        </div>
      </header>

      <div className="a-cash__grid">
        <section>
          <h2 className="a-cash__h2">Awaiting payment</h2>
          <ul className="a-cash__queue">
            {counterQueue.map((o) => (
              <li key={o.id} className={`a-cash__qItem ${o.id === order.id ? 'is-active' : ''}`}>
                <div className="a-cash__qTop">
                  <strong>{o.id}</strong>
                  <span className="a-cash__qTable">{o.table}</span>
                  <span className="a-cash__qTime">{o.at}</span>
                </div>
                <div className="a-cash__qItems">{o.items}</div>
                <div className="a-cash__qFoot">
                  <span className="a-cash__qState">{o.state}</span>
                  <strong className="tnum">{inr(o.total)}</strong>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="a-cash__detail">
          <div className="a-cash__detailHead">
            <div>
              <div className="a-cash__kicker">Order {order.id} · {order.table}</div>
              <h2 className="a-cash__amount">{inr(order.total)}</h2>
            </div>
            <span className="a-cash__due">Payment due</span>
          </div>

          <ul className="a-cash__lines">
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
          <div className="a-cash__totalRow">
            <span>Total due</span>
            <strong className="tnum">{inr(order.total)}</strong>
          </div>

          <div className="a-cash__methods">
            {(['cash', 'card', 'upi'] as const).map((m) => (
              <button key={m} className={`a-cash__method ${method === m ? 'is-on' : ''}`} onClick={() => setMethod(m)}>
                {m === 'cash' ? 'Cash' : m === 'card' ? 'Card' : 'UPI'}
              </button>
            ))}
          </div>

          <div className="a-cash__field">
            <label className="ui-label">Amount received</label>
            <input className="ui-input tnum" defaultValue={received} />
            <div className="ui-hint">
              Change to return: <strong>{inr(change)}</strong>
            </div>
          </div>

          <button className="a-cash__cta">Record payment received</button>
          <p className="a-cash__fine">
            Recording payment creates an audited entry and turns the order into a paid receipt. Prototype —
            nothing is saved.
          </p>
        </section>
      </div>
    </div>
  );
}

/* ============================================================================
   Option B — Modern Operations cashier
   ========================================================================== */
export function CashierB() {
  const [method, setMethod] = useState<'cash' | 'card' | 'upi'>('upi');
  const order = counterQueue[0];

  return (
    <div className="b-cash">
      <header className="b-cash__top">
        <div className="b-cash__brand">₹ Cashier · {restaurant.name}</div>
        <div className="b-cash__chips">
          <span className="b-cash__chip is-alert">3 due</span>
          <span className="b-cash__chip">{inr(2964)} outstanding</span>
          <span className="b-cash__chip">Shift: Aryan · opened 11:00</span>
        </div>
        <div className="b-cash__right">
          <span className="b-cash__btn">Reprint last</span>
          <span className="b-cash__btn b-cash__btn--solid">Reconcile shift</span>
        </div>
      </header>

      <div className="b-cash__body">
        <section className="b-cash__list">
          <div className="b-cash__sectionHead">
            <h2>Counter payments</h2>
            <span>Sorted: oldest first</span>
          </div>
          <table className="ui-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Tbl</th>
                <th>At</th>
                <th>State</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {counterQueue.map((o) => (
                <tr key={o.id} className={o.id === order.id ? 'is-active' : undefined}>
                  <td className="tnum">
                    <strong>{o.id}</strong>
                  </td>
                  <td>{o.table}</td>
                  <td className="tnum">{o.at}</td>
                  <td>
                    <span className={`b-cash__state b-cash__state--${o.state.toLowerCase()}`}>{o.state}</span>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <strong>{inr(o.total)}</strong>
                  </td>
                  <td>
                    <span className="b-cash__btn b-cash__btn--sm">Open</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="b-cash__sectionHead">
            <h2>Recorded this shift</h2>
            <span>18 payments</span>
          </div>
          <table className="ui-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Order</th>
                <th>Method</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['12:31', 'A-1040', 'Card', 985],
                ['12:24', 'A-1039', 'UPI', 864],
                ['12:12', 'A-1037', 'Cash', 1420],
              ].map(([t, id, m, amt]) => (
                <tr key={id as string}>
                  <td className="tnum">{t}</td>
                  <td className="tnum">{id}</td>
                  <td>{m}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {inr(amt as number)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="b-cash__panel">
          <div className="b-cash__panelHead">
            <div>
              <div className="b-cash__kicker">{order.id} · {order.table}</div>
              <div className="b-cash__amount tnum">{inr(order.total)}</div>
            </div>
            <span className="b-cash__dueTag">DUE</span>
          </div>

          <ul className="b-cash__lines">
            {RECEIPT_LINES.map((l) => (
              <li key={l.name}>
                <span>
                  <strong>{l.q}×</strong> {l.name}
                </span>
                <span className="tnum">{inr(l.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="b-cash__rows">
            <div>
              <span>Subtotal</span>
              <span className="tnum">{inr(736)}</span>
            </div>
            <div>
              <span>Taxes (sample)</span>
              <span className="tnum">{inr(order.total - 736)}</span>
            </div>
            <div className="is-total">
              <span>Due</span>
              <span className="tnum">{inr(order.total)}</span>
            </div>
          </div>

          <div className="b-cash__methodGrid">
            {(['cash', 'card', 'upi'] as const).map((m) => (
              <button key={m} className={`b-cash__method ${method === m ? 'is-on' : ''}`} onClick={() => setMethod(m)}>
                {m === 'cash' ? 'Cash' : m === 'card' ? 'Card' : 'UPI'}
              </button>
            ))}
          </div>

          <div className="b-cash__field">
            <label className="ui-label">Tendered</label>
            <input className="ui-input tnum" defaultValue={order.total} />
          </div>

          <button className="b-cash__cta">Record payment · {inr(order.total)}</button>
          <div className="b-cash__audit">
            Every recorded payment is written to the audit log with the staff member, time and method.
          </div>

          <div className="b-cash__receipt">
            <div className="b-cash__receiptHead">Receipt preview</div>
            <div className="b-cash__receiptBody">
              <div className="b-cash__receiptTitle">{restaurant.name}</div>
              <div className="b-cash__receiptMeta">{restaurant.address}</div>
              <div className="b-cash__receiptMeta">{restaurant.gstin}</div>
              <div className="b-cash__rule" />
              {RECEIPT_LINES.map((l) => (
                <div key={l.name} className="b-cash__receiptLine">
                  <span>
                    {l.q} × {l.name}
                  </span>
                  <span className="tnum">{inr(l.amount)}</span>
                </div>
              ))}
              <div className="b-cash__rule" />
              <div className="b-cash__receiptLine is-strong">
                <span>Total</span>
                <span className="tnum">{inr(736)}</span>
              </div>
              <div className="b-cash__receiptQr">
                <QrChip value={`receipt-${order.id}`} size={54} />
                <span>Scan to open the digital receipt</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================================
   Option C — Warm Hospitality cashier
   ========================================================================== */
export function CashierC() {
  const [method, setMethod] = useState<'cash' | 'card' | 'upi'>('card');
  const order = counterQueue[1];

  return (
    <div className="c-cash">
      <header className="c-cash__head">
        <h1>Counter payments</h1>
        <p>{restaurant.name} · 3 orders waiting</p>
      </header>

      <div className="c-cash__grid">
        <section className="c-cash__queue">
          {counterQueue.map((o) => (
            <article key={o.id} className={`c-cash__card ${o.id === order.id ? 'is-on' : ''}`}>
              <div className="c-cash__cardTop">
                <div>
                  <strong>{o.id}</strong> <span className="c-cash__muted">· {o.table}</span>
                </div>
                <span className="c-cash__time">{o.at}</span>
              </div>
              <p className="c-cash__items">{o.items}</p>
              <div className="c-cash__cardFoot">
                <span className={`c-cash__state c-cash__state--${o.state.toLowerCase()}`}>{o.state}</span>
                <strong className="tnum">{inr(o.total)}</strong>
              </div>
            </article>
          ))}
        </section>

        <aside className="c-cash__panel">
          <div className="c-cash__amountCard">
            <div className="c-cash__amountLabel">Amount due · {order.table}</div>
            <div className="c-cash__amount tnum">{inr(order.total)}</div>
            <div className="c-cash__amountMeta">{order.items}</div>
          </div>

          <div className="c-cash__methods">
            {(['cash', 'card', 'upi'] as const).map((m) => (
              <button key={m} className={`c-cash__method ${method === m ? 'is-on' : ''}`} onClick={() => setMethod(m)}>
                {m === 'cash' ? '💵 Cash' : m === 'card' ? '💳 Card' : '📱 UPI'}
              </button>
            ))}
          </div>

          <button className="c-cash__cta">Mark as paid · {inr(order.total)}</button>
          <p className="c-cash__fine">The receipt updates the moment payment is recorded.</p>

          <div className="c-cash__receipt">
            <div className="c-cash__receiptHead">
              Receipt
              <span className="c-cash__receiptBtns">
                <span>Print</span>
                <span>Save PDF</span>
              </span>
            </div>
            <div className="c-cash__receiptBody">
              <strong>{restaurant.name}</strong>
              <span className="c-cash__muted">{restaurant.address}</span>
              <span className="c-cash__muted">Order {order.id} · {order.at} · Table {order.table}</span>
              <div className="c-cash__rule" />
              {RECEIPT_LINES.map((l) => (
                <div key={l.name} className="c-cash__rLine">
                  <span>
                    {l.q} × {l.name}
                  </span>
                  <span className="tnum">{inr(l.amount)}</span>
                </div>
              ))}
              <div className="c-cash__rule" />
              <div className="c-cash__rLine is-strong">
                <span>Paid by {method === 'cash' ? 'cash' : method === 'card' ? 'card' : 'UPI'}</span>
                <span className="tnum">{inr(736)}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
