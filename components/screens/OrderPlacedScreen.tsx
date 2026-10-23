import Link from 'next/link';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import { GuestOrderEditor } from '@/components/screens/GuestOrderEditor';
import { PayOnline } from '@/components/PayOnline';
import { PayUpi } from '@/components/PayUpi';
import { GuestFlow } from '@/components/GuestFlow';
import { accentStyle } from '@/lib/branding/palette';
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
    <ol data-placed-track="" aria-label="Kitchen progress" className="mt-5 flex flex-col gap-0">
      {PREP_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'now' : 'todo';
        return (
          <li key={step.key} data-placed-step={state} className="flex items-start gap-3">
            {/* The rail between marks is what makes four rows read as one
                track rather than four statements. It is drawn by the row, and
                stops at the last one, so the line never runs past "Served". */}
            <span aria-hidden="true" className="flex flex-col items-center self-stretch">
              <span
                className={[
                  'mt-1 grid size-3 shrink-0 place-items-center rounded-full ring-2',
                  state === 'todo' ? 'bg-paper ring-gink-12' : 'bg-[var(--p-accent)] ring-accent-soft',
                ].join(' ')}
              />
              {index < PREP_STEPS.length - 1 && (
                <span
                  className={[
                    'my-1 w-px flex-1',
                    state === 'done' ? 'bg-[var(--p-accent)]/45' : 'bg-gink-12',
                  ].join(' ')}
                />
              )}
            </span>
            <span
              className={[
                'pb-3 text-[13px] leading-tight',
                state === 'now' ? 'font-semibold text-gink' : state === 'done' ? 'text-gink-64' : 'text-gink-64',
              ].join(' ')}
            >
              {step.label}
              {index === currentIndex ? <span className="sr-only"> — where it is now</span> : null}
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
  accent,
}: {
  data: OrderScreenData | null;
  /** Palette key from the restaurant row; see lib/branding/palette.ts. */
  accent?: string;
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
      <div className="mx-auto min-h-dvh w-full max-w-[560px] bg-paper px-5 py-16 text-gink">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-gink-46 uppercase">Order</p>
        <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-[-0.025em]">Order not found</h1>
        <p className="mt-3 text-[14.5px] leading-[1.55] text-gink-64">
          We could not find that order. It may have been closed, or the link may be
          incomplete.
        </p>
        {/* The slug is carried through when we have one. A bare /menu is
            not "the menu" against a configured database -- it is the
            "open this from your table" page, which is a dead end for
            somebody whose order has just failed to load. */}
        <Link
          href={slug ? `/menu?s=${encodeURIComponent(slug)}` : '/menu'}
          className="mt-6 inline-flex rounded-full bg-gink px-4 py-2.5 text-[13px] font-semibold text-onink"
        >
          Back to the menu
        </Link>
      </div>
    );
  }

  const prepLabel = PREP_LABEL[data.prepStatus] ?? data.prepStatus;

  const menuHref = slug ? `/menu?s=${encodeURIComponent(slug)}` : '/menu';

  return (
    <GuestFlow
      step="placed"
      style={accentStyle(accent)}
      venue={data.restaurantName}
      table={data.tableLabel}
      dock={
        /* The flow does not end here: a table usually orders again, and the
           screen used to offer no way back to the menu at all. */
        <Link
          href={menuHref}
          className="flex h-12 w-full items-center justify-center rounded-full bg-[var(--p-accent)] text-[14px] font-semibold text-white shadow-g1 transition active:scale-[0.99]"
        >
          Order something else
        </Link>
      }
    >
      <header className="px-4 pt-7 pb-5">
        {/* The one moment in the flow that deserves a mark. Drawn rather than
            typed: a tick in a circle reads at a glance from across a table,
            and it is the only decoration on the screen. */}
        <span
          data-placed-mark={data.prepStatus === 'cancelled' ? 'void' : 'ok'}
          aria-hidden="true"
          className={[
            'grid size-11 place-items-center rounded-full ring-1',
            data.prepStatus === 'cancelled'
              ? 'bg-[var(--alert)]/10 text-[var(--alert)] ring-[var(--alert)]/25'
              : 'bg-accent-soft text-[var(--p-accent)] ring-[var(--p-accent)]/25',
          ].join(' ')}
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

        <p className="mt-3.5 text-[10.5px] font-semibold tracking-[0.12em] text-gink-46 uppercase">
          {data.prepStatus === 'cancelled' ? 'Order cancelled' : 'Order placed'}
        </p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.025em] text-gink">
          {data.tableLabel ? `Table ${data.tableLabel}` : 'Counter order'}
        </h1>
        <p className="mt-1 text-[13.5px] leading-[1.5] text-gink-64">
          {data.restaurantName} · {prepLabel}
          {data.prepStatus === 'cancelled' ? ' · nothing is owed' : ''}
        </p>

        <p aria-label="Order reference" className="mt-3 flex items-center gap-2 text-[11.5px] text-gink-46">
          <span className="tracking-[0.08em] uppercase">Reference</span>
          <strong className="tnum rounded-md bg-gink-07 px-2 py-1 text-[13px] tracking-[0.12em] text-gink">
            {data.code}
          </strong>
        </p>

        {/* What happens next, from the state the kitchen last wrote. A
            cancelled order has no track: there is nothing left to move
            through, and drawing four steps with none of them reached would
            read as an order about to start. */}
        {data.prepStatus === 'cancelled' ? (
          <p className="mt-4 rounded-2xl bg-gink-07 px-4 py-3 text-[13px] leading-[1.5] text-gink-64">
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

      <div className="px-4 pb-8">
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
          <div className="mt-3 rounded-2xl border border-hair bg-card px-4 py-3 text-[13px] leading-[1.5] text-gink-64">
            <strong className="font-semibold text-gink">Your note:</strong> {data.customerNote}
          </div>
        )}

        {/* A small reference, not the headline. The kitchen is told the table
            and the dishes, which is what a cook acts on; this is only for the
            moment at the counter where the bill has to be found, and for a
            takeaway there is no table to find it by. */}
        <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
          Quote the reference above if staff ask — it is how the counter finds this bill.
        </p>

        <section className="mt-4 rounded-2xl border border-hair-strong bg-card px-4 py-4">
          <h2 className="mb-1 text-[11px] font-semibold tracking-[0.1em] text-gink-46 uppercase">Bill</h2>
          <dl className="text-[13.5px]">
            <div className="flex items-baseline justify-between py-1 text-gink-64">
              <dt>Subtotal</dt>
              <dd className="tnum">{inr(paiseToRupees(data.subtotalPaise))}</dd>
            </div>
            <div className="flex items-baseline justify-between py-1 text-gink-64">
              <dt>Taxes</dt>
              <dd className="tnum">{inr(paiseToRupees(data.taxPaise))}</dd>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between border-t border-hair pt-2.5 text-[16px] font-semibold text-gink">
              <dt>Total</dt>
              <dd className="tnum">{inr(paiseToRupees(data.totalPaise))}</dd>
            </div>
          </dl>

          {data.prepStatus === 'cancelled' ? (
            <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
              <strong className="font-semibold text-gink">This order was cancelled.</strong> Nothing is being cooked and nothing
              is owed. Order again from the menu whenever you are ready.
            </p>
          ) : data.paymentStatus === 'pending' ? (
            <>
              {/*
                The restaurant's own UPI QR comes first when it has one: it is
                the way most guests will actually pay, and it needs no gateway.
                It is offered alongside the counter, never instead of it -- a
                phone with a dead battery still has to be able to leave.
              */}
              {data.upi && slug && token ? (
                <PayUpi upi={data.upi} slug={slug} code={data.code} token={token} />
              ) : null}

              {data.upi ? (
                <p className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">
                  Or pay at the counter before you leave — the kitchen has your order already.
                </p>
              ) : onlinePay?.available && slug && token ? (
                <>
                  <PayOnline
                    slug={slug}
                    code={data.code}
                    token={token}
                    duePaise={data.totalPaise}
                  />
                  <p className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">
                    Or pay at the counter before you leave — the kitchen has your order
                    already and is starting on it now.
                  </p>
                </>
              ) : (
                <>
                  {onlinePay?.note ? (
                    <p className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">{onlinePay.note}</p>
                  ) : null}
                  <p className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">
                    <strong className="font-semibold text-gink">Pay at the counter before you leave.</strong> The kitchen has
                    your order already and is starting on it now.
                  </p>
                </>
              )}
            </>
          ) : (
            <p className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">Paid. Thank you.</p>
          )}
        </section>
      </div>
    </GuestFlow>
  );
}
