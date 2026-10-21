import Link from 'next/link';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import { GuestOrderEditor } from '@/components/screens/GuestOrderEditor';
import { GUEST_CHANGE_WINDOW_MS, type OrderScreenData } from '@/lib/db/order-screen';

/**
 * Why the guest cannot change this order any more, in their own words.
 *
 * Returning a sentence rather than a boolean matters: a screen that silently
 * drops the buttons leaves the guest tapping a dead bill and guessing.
 */
function lockedReason(data: OrderScreenData): string {
  if (data.prepStatus === 'cancelled') {
    return 'This order was cancelled, so nothing is being cooked and nothing is owed.';
  }
  if (data.paymentStatus !== 'pending') return '';
  if (data.prepStatus !== 'new') {
    return 'The kitchen has started on this order, so it cannot be changed here. Please ask the staff.';
  }

  const placed = new Date(data.placedAt).getTime();
  if (!Number.isNaN(placed) && Date.now() - placed > GUEST_CHANGE_WINDOW_MS) {
    return 'Orders can only be changed in the first ten minutes, and this one is older. Please ask the staff.';
  }

  return '';
}

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
export function OrderPlacedScreen({
  data,
  token,
}: {
  data: OrderScreenData | null;
  /** The guest's credential from the URL. Absent on a stale or hand-typed link. */
  token?: string;
}) {
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
        <h1>{data.tableLabel ? `Table ${data.tableLabel}` : 'Counter order'}</h1>
        <p>
          {data.restaurantName} · {prepLabel}
          {data.prepStatus === 'cancelled' ? ' · nothing is owed' : ''}
        </p>
      </header>

      <div className="cart__grid">
        <div className="cart__lines">
          {/*
            The lines are rendered by a client component because, for the
            first ten minutes, they carry quantity controls and a cancel
            button. Prices still come from the server: the editor only
            multiplies the unit price already on screen, and the database
            recomputes the bill when it saves.
          */}
          <GuestOrderEditor
            orderId={data.id}
            token={token ?? ''}
            lines={data.lines}
            canEdit={Boolean(token) && data.canGuestChange}
            lockedReason={token ? lockedReason(data) : 'Open this page from the link you were given after ordering to see or change the order.'}
            subtotalPaise={data.subtotalPaise}
          />

          {data.customerNote && (
            <div className="cart__empty">
              <strong>Your note:</strong> {data.customerNote}
            </div>
          )}

          {/*
            A small reference, not the headline. The kitchen is told the table
            and the dishes, which is what a cook acts on; this is only for the
            moment at the counter where the bill has to be found, and for a
            takeaway there is no table to find it by.
          */}
          <p className="cart__fine">
            Reference {data.code} — quote this if staff ask.
          </p>
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

            {data.prepStatus === 'cancelled' ? (
              <p className="cart__fine">
                <strong>This order was cancelled.</strong> Nothing is being cooked and nothing
                is owed. Order again from the menu whenever you are ready.
              </p>
            ) : data.paymentStatus === 'pending' ? (
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
