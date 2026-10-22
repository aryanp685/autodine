import Link from 'next/link';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import { GuestOrderEditor } from '@/components/screens/GuestOrderEditor';
import { PayOnline } from '@/components/PayOnline';
import { OrderStatusRefresh } from '@/components/OrderStatusRefresh';
import { GUEST_CHANGE_WINDOW_MS, type OrderScreenData } from '@/lib/db/order-screen';
import type { OnlineOffer } from '@/lib/payments/online-availability';

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
 * The four states a ticket actually moves through, in the order it moves.
 *
 * Read straight from `prepStatus`, which the kitchen board writes. This is not
 * a decorative progress bar: every mark on it corresponds to a state the
 * database holds, and the guest can compare it with what is on the table.
 *
 * `preparing` used to be called "cooking" on the board and "preparing" here;
 * one product, one word.
 */
const PREP_STEPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'new', label: 'Sent to the kitchen' },
  { key: 'preparing', label: 'Being cooked' },
  { key: 'ready', label: 'Ready to serve' },
  { key: 'served', label: 'Served' },
];

function OrderTrack({ prepStatus }: { prepStatus: string }) {
  const currentIndex = PREP_STEPS.findIndex((step) => step.key === prepStatus);
  // An unrecognised state has no position on a four-step track, so nothing is
  // marked rather than the first step being marked by accident.
  if (currentIndex < 0) return null;

  return (
    <ol className="placed__track" aria-label="Kitchen progress">
      {PREP_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'is-done' : index === currentIndex ? 'is-now' : 'is-todo';
        return (
          <li key={step.key} className={`placed__step ${state}`}>
            <span className="placed__stepDot" aria-hidden="true" />
            <span className="placed__stepLabel">
              {step.label}
              {index === currentIndex ? <span className="gnote__sr"> — where it is now</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Confirmation, and the only screen that tells the diner what happens next.
 *
 * It says plainly how the bill gets paid. When the restaurant takes card
 * online the button is here; when it does not, or this deployment has no
 * gateway key, the screen says "pay at the counter" in as many words. Staying
 * quiet would leave someone waiting for a card prompt that is never coming.
 */
export function OrderPlacedScreen({
  data,
  token,
  slug,
  onlinePay,
}: {
  data: OrderScreenData | null;
  /** The guest's credential from the URL. Absent on a stale or hand-typed link. */
  token?: string;
  /** Which restaurant, for the pay button's server call. */
  slug?: string;
  /**
   * Whether card payment may be offered on this order, decided on the server
   * (lib/payments/online-availability.ts). Null means the order could not be
   * read at all.
   */
  onlinePay?: OnlineOffer | null;
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
            {/* The slug is carried through when we have one. A bare /menu is
                not "the menu" against a configured database -- it is the
                "open this from your table" page, which is a dead end for
                somebody whose order has just failed to load. */}
            <Link href={slug ? `/menu?s=${encodeURIComponent(slug)}` : '/menu'}>
              Back to the menu
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const prepLabel = PREP_LABEL[data.prepStatus] ?? data.prepStatus;

  return (
    <div className="cart cart--placed">
      <header className="cart__head placed__head">
        {/* The one moment in the flow that deserves a mark. Drawn rather than
            typed: a tick in a circle reads at a glance from across a table,
            and it is the only decoration on the screen. */}
        <span
          className={`placed__mark ${data.prepStatus === 'cancelled' ? 'is-void' : 'is-ok'}`}
          aria-hidden="true"
        >
          {data.prepStatus === 'cancelled' ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <div className="cart__kicker">
          {data.prepStatus === 'cancelled' ? 'Order cancelled' : 'Order placed'}
        </div>
        <h1>{data.tableLabel ? `Table ${data.tableLabel}` : 'Counter order'}</h1>
        <p>
          {data.restaurantName} · {prepLabel}
          {data.prepStatus === 'cancelled' ? ' · nothing is owed' : ''}
        </p>
        <p className="cart__code" aria-label="Order reference">
          <span>Reference</span> <strong>{data.code}</strong>
        </p>

        {/* What happens next, from the state the kitchen last wrote. A
            cancelled order has no track: there is nothing left to move
            through, and drawing four steps with none of them reached would
            read as an order about to start. */}
        {data.prepStatus === 'cancelled' ? (
          <p className="placed__cancelled">
            Nothing is being cooked and nothing is owed. Order again from the menu whenever you
            are ready.
          </p>
        ) : (
          <>
            <OrderTrack prepStatus={data.prepStatus} />
            {/* Only when the guest cannot edit any more: see the comment in
                OrderStatusRefresh for why a refresh must not land on a screen
                holding unsaved changes. */}
            {!data.canGuestChange ? <OrderStatusRefresh /> : null}
          </>
        )}
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
            Quote the reference above if staff ask — it is how the counter finds this bill.
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
              <>
                {onlinePay?.available && slug && token ? (
                  <>
                    <PayOnline
                      slug={slug}
                      code={data.code}
                      token={token}
                      duePaise={data.totalPaise}
                    />
                    <p className="cart__fine">
                      Or pay at the counter before you leave — the kitchen has your order
                      already and is starting on it now.
                    </p>
                  </>
                ) : (
                  <>
                    {onlinePay?.note ? <p className="cart__fine">{onlinePay.note}</p> : null}
                    <p className="cart__fine">
                      <strong>Pay at the counter before you leave.</strong> The kitchen has
                      your order already and is starting on it now.
                    </p>
                  </>
                )}
              </>
            ) : (
              <p className="cart__fine">Paid. Thank you.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
