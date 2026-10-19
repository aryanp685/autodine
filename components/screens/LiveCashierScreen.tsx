'use client';

import { useState, type ReactNode } from 'react';
import { createCounterOrderAction, recordCashPaymentAction } from '@/app/cashier/actions';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { paiseToRupees } from '@/lib/money';
import type { AuthorizedWorkspace } from '@/lib/db/workspace-selection';

type MenuOption = { id: string; name: string; price_paise: number; is_veg: boolean };
type OrderLine = { name_snapshot: string; qty: number; unit_price_paise: number };
type CashierOrder = {
  id: string;
  code: string;
  tableLabel: string;
  customer_note: string | null;
  total_paise: number;
  placed_at_label: string;
  items: OrderLine[];
};

type Props = {
  workspace: AuthorizedWorkspace;
  workspaces: AuthorizedWorkspace[];
  menuItems: MenuOption[];
  orders: CashierOrder[];
  paymentKeys: Record<string, string>;
  error?: string;
};

const inr = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
}).format(paiseToRupees(paise));

function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return <button type="submit" className="cash__cta" disabled={disabled}>{children}</button>;
}

export function LiveCashierScreen({
  workspace,
  workspaces,
  menuItems,
  orders,
  paymentKeys,
  error,
}: Props) {
  const [lines, setLines] = useState([{ itemId: menuItems[0]?.id ?? '', qty: 1 }]);
  const itemsPayload = JSON.stringify(lines.map(({ itemId, qty }) => ({ item_id: itemId, qty })));
  const outstanding = orders.reduce((sum, order) => sum + order.total_paise, 0);
  const statusMessage = error === 'access'
    ? 'Access could not be verified. Sign in again or select an authorized workspace.'
    : error === 'permission'
      ? 'Your role cannot use cashier actions in this workspace.'
      : error === 'items'
        ? 'Choose an available menu item and a valid quantity.'
        : error === 'payment-input'
          ? 'The payment request was invalid. Refresh the order and retry.'
          : error === 'read-only'
            ? 'This restaurant is read-only. Existing data is preserved; restore access before writing.'
            : error === 'amount'
              ? 'Cash amount must match the full outstanding balance exactly.'
              : error === 'cancelled'
                ? 'Cancelled orders cannot be settled.'
                : error === 'already-paid'
                  ? 'This order is no longer awaiting payment.'
                  : error === 'request'
                    ? 'The request could not be verified. Check the order state and try again.'
                    : '';

  return (
    <div className="cash" data-app>
      <header className="cash__head">
        <div>
          <div className="cash__kicker">Live cashier · authenticated workspace</div>
          <h1 className="cash__h1">{workspace.name}</h1>
          <div className="live-cash__role">Signed in with {workspace.role} access</div>
        </div>
        <div className="cash__headMeta live-cash__workspace">
          <WorkspaceSwitcher workspaces={workspaces} selectedSlug={workspace.slug} pathname="/cashier" />
          <span>{orders.length} unpaid orders</span>
          <span className="cash__outstanding">{inr(outstanding)} outstanding</span>
        </div>
      </header>

      {statusMessage && <div className={`live-cash__status ${error ? 'is-error' : 'is-success'}`} role="status">{statusMessage}</div>}

      <div className="cash__grid live-cash__grid">
        <section>
          <h2 className="cash__h2">Unpaid orders</h2>
          {orders.length ? (
            <ul className="cash__queue">
              {orders.map((order) => (
                <li key={order.id} className="cash__qItem">
                  <div className="cash__qTop">
                    <strong>{order.code}</strong>
                    <span className="cash__qTable">{order.tableLabel}</span>
                    <span className="cash__qTime">{order.placed_at_label}</span>
                  </div>
                  <div className="cash__qItems">
                    {order.items.length
                      ? order.items.map((item) => `${item.qty}× ${item.name_snapshot}`).join(' · ')
                      : 'Order details unavailable'}
                  </div>
                  {order.customer_note && <div className="live-cash__note">Note: {order.customer_note}</div>}
                  <div className="cash__qFoot">
                    <span className="cash__qState">Payment pending</span>
                    <strong className="tnum">{inr(order.total_paise)}</strong>
                  </div>
                  <form action={recordCashPaymentAction} className="live-cash__paymentForm">
                    <input type="hidden" name="workspace" value={workspace.slug} />
                    <input type="hidden" name="order_id" value={order.id} />
                    <input type="hidden" name="amount_paise" value={order.total_paise} />
                    <input type="hidden" name="idempotency_key" value={paymentKeys[order.id]} />
                    <p className="cash__fine">Confirm that the exact outstanding amount has been received in cash. Online/card/UPI collection is not enabled.</p>
                    <SubmitButton>Confirm cash · {inr(order.total_paise)}</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cash__fine">No unpaid orders in this workspace.</p>
          )}
        </section>

        <section className="cash__detail" aria-labelledby="counter-order-title">
          <div className="cash__detailHead">
            <div>
              <div className="cash__kicker">Create a walk-in counter order</div>
              <h2 className="live-cash__title" id="counter-order-title">Add items</h2>
            </div>
            <span className="cash__due">Starts unpaid</span>
          </div>
          {menuItems.length ? (
            <form action={createCounterOrderAction}>
              <input type="hidden" name="workspace" value={workspace.slug} />
              <input type="hidden" name="items" value={itemsPayload} />
              <div className="live-cash__lines">
                {lines.map((line, index) => (
                  <div className="live-cash__line" key={index}>
                    <label className="live-cash__field">
                      <span className="ui-label">Menu item</span>
                      <select
                        className="ui-select"
                        value={line.itemId}
                        onChange={(event) => setLines((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, itemId: event.target.value } : item,
                        ))}
                        required
                      >
                        {menuItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {inr(item.price_paise)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="live-cash__field live-cash__qty">
                      <span className="ui-label">Qty</span>
                      <input
                        className="ui-input tnum"
                        type="number"
                        min="1"
                        step="1"
                        value={line.qty}
                        onChange={(event) => {
                          const next = Number.parseInt(event.target.value, 10);
                          setLines((current) => current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, qty: Number.isFinite(next) && next > 0 ? next : 1 } : item,
                          ));
                        }}
                      />
                    </label>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="live-cash__remove"
                        aria-label={`Remove item ${index + 1}`}
                        onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="live-cash__add"
                onClick={() => setLines((current) => [...current, { itemId: menuItems[0].id, qty: 1 }])}
              >+ Add another item</button>
              <label className="live-cash__field live-cash__noteField">
                <span className="ui-label">Kitchen note (optional)</span>
                <textarea className="ui-input" name="note" rows={2} maxLength={500} />
              </label>
              <p className="cash__fine">Prices and totals are recalculated by the database. This creates an unpaid order; record cash separately after receiving it.</p>
              <SubmitButton>Create unpaid order</SubmitButton>
            </form>
          ) : (
            <p className="cash__fine">No available menu items were found. Add/publish items before creating a counter order.</p>
          )}
        </section>
      </div>
      <p className="live-cash__footer">Live actions are authorized server-side for this workspace. Payment status cannot be changed directly.</p>
    </div>
  );
}
