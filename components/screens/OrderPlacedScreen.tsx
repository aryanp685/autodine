import Link from 'next/link';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import type { OrderScreenData } from '@/lib/db/order-screen';

const PREP_LABEL: Record<string, string> = {
  new: 'Sent to the kitchen',
  preparing: 'Being cooked',
  ready: 'Ready to serve',
  served: 'Served',
  cancelled: 'Cancelled',
};

/**
 * Confirmation, and the only screen that tells the diner what happens next.
 *
 * It says plainly that payment happens at the counter, because online payment
 * is not connected and a screen that stayed quiet about it would leave someone
 * waiting for a card prompt that is never coming.
 */
export function OrderPlacedScreen({ data }: { data: OrderScreenData | null }) {
  if (!data) {
    return (
      <div className="cart">
        <header className="cart__head">
          <h1>Order not found</h1>
          <p>
            We could not find that order. It may have been closed, or the link may be
            incomplete.
          </p>
        </header>
        <div className="cart__grid">
          <div className="cart__empty">
            <Link href="/menu">Back to the menu</Link>
          </div>
        </div>
      </div>
    );
  }

  const prepLabel = PREP_LABEL[data.prepStatus] ?? data.prepStatus;

  return (
    <div className="cart">
      <header className="cart__head">
        <h1>Order {data.code}</h1>
        <p>
          {data.restaurantName} · {prepLabel}
        </p>
      </header>

      <div className="cart__grid">
        <div className="cart__lines">
          {data.lines.map((l, i) => (
            <div key={`${l.name}-${i}`} className="cart__line">
              <div className="cart__lineMain">
                <div className="cart__lineTop">
                  <VegMark veg={l.isVeg} />
                  <strong>{l.name}</strong>
                </div>
                <div className="cart__linePrice tnum">
                  {inr(paiseToRupees(l.unitPricePaise))} each
                </div>
              </div>
              <div className="cart__qty">
                <span className="tnum">{l.qty}</span>
              </div>
              <div className="cart__lineTotal tnum">
                {inr(paiseToRupees(l.lineTotalPaise))}
              </div>
            </div>
          ))}

          {data.customerNote && (
            <div className="cart__empty">
              <strong>Your note:</strong> {data.customerNote}
            </div>
          )}
        </div>

        <aside className="cart__sum">
          <div className="cart__sumCard">
            <h2>Bill</h2>
            <div className="totals__row">
              <span>Subtotal</span>
              <span className="tnum">{inr(paiseToRupees(data.subtotalPaise))}</span>
            </div>
            <div className="totals__row">
              <span>Taxes</span>
              <span className="tnum">{inr(paiseToRupees(data.taxPaise))}</span>
            </div>
            <div className="totals__row totals__row--total">
              <span>Total</span>
              <span className="tnum">{inr(paiseToRupees(data.totalPaise))}</span>
            </div>

            {data.paymentStatus === 'pending' ? (
              <p className="cart__fine">
                <strong>Pay at the counter before you leave.</strong> The kitchen has your
                order already and is starting on it now.
              </p>
            ) : (
              <p className="cart__fine">Paid. Thank you.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
