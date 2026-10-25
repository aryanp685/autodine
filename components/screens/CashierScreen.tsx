'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { counterQueue, inr, restaurant } from '@/lib/demo-data';
import type { CashierScreenData, CounterOrder } from '@/lib/db/cashier-screen';
// Value import, so it comes from the database-free module. Importing
// COUNTER_METHODS from lib/db/cashier-screen would pull lib/supabase/server
// into the browser bundle -- type-only imports there are fine, this is not.
import { COUNTER_METHODS, COUNTER_METHOD_LABEL, type CounterMethod } from '@/lib/payment-methods';
import { recordPaymentAction } from '@/app/cashier/actions';
import { cancelStaffOrderAction } from '@/app/orders/actions';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  PageHead,
  SectionHead,
  Card,
  Panel,
  BtnLink,
  btn,
  Dot,
  Tag,
  Empty,
  Notice,
  Segmented,
} from '@/components/owner/chrome';

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
  /**
   * The guest pressed "I have paid" against the restaurant's UPI QR. A claim,
   * not money: the transfer happened in an app we cannot see. Shown so the
   * cashier checks the shop's own bank app before taking cash twice.
   */
  claimed: boolean;
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
    claimed: false,
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
    claimed: order.claimed === true,
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

   Cash, card and UPI. All three go through one database function,
   record_counter_payment (migration 0004). None of them process anything:
   the guest pays on a terminal or by scanning a code, and this screen records
   that it happened. No provider is contacted.

   The amount is never typed in. The function accepts exactly the outstanding
   balance and nothing else, so there is no "amount received" and no change to
   compute -- the server works the figure out from the order and any payments
   already recorded against it.

   THREE THINGS THIS SCREEN COULD NOT DO, NOW FIXED

   1. It could not be left. The counter rendered no navigation at all -- no
      bar, no sign-out, no way back to the dashboard -- so a cashier's only
      exit was the browser's back button. The bar is now rendered by the
      server page and passed in as `nav`: this component is a Client
      Component, and the sign-out form inside the bar is a server action, so
      it cannot be imported from here without dragging server-only modules
      into the browser bundle.

   2. The cashier could not choose a ticket. `order` was `visible[0]`, full
      stop, so the queue could only ever be settled oldest-first. With a guest
      at the counter holding order #4 of six, there was nothing to press.

   3. In demo mode the settle button was disabled and said nothing about why:
      demo rows have no database id, so a preview queue could never be
      cleared. The preview now settles locally, says that it recorded
      nothing, and the reset button brings the queue back -- the same honesty
      the kitchen board uses for its sample tickets.

   And a fourth, quieter one: `data.blocked` was returned by the loader and
   never rendered, so a signed-out visitor saw an empty counter and no
   explanation. That is what "the restaurant has no orders" looks like.
   ========================================================================== */
export function Cashier({
  data,
  nav,
  focus,
}: {
  data?: CashierScreenData | null;
  /** The shared app bar, rendered by the server page. */
  nav?: ReactNode;
  /**
   * The bill the ledger asked for, from `?order=`.
   *
   * The order ledger and the counter are the same queue seen twice: a row with
   * money due says "Collect", and that has to land on THAT ticket rather than
   * on whichever one happens to be oldest.
   */
  focus?: string;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<CounterMethod>('cash');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [settling, setSettling] = useState<string[]>([]);
  /** Orders settled or cancelled locally, in demo mode only. */
  const [demoDone, setDemoDone] = useState<string[]>([]);
  /** Which ticket the cashier is looking at. Null means "the oldest one". */
  const [selectedKey, setSelectedKey] = useState<string | null>(focus?.trim() || null);
  /** Has the cashier dismissed the note about a bill that is no longer waiting? */
  const [focusDismissed, setFocusDismissed] = useState(false);
  /** The order the cashier has asked to cancel, before they confirm. */
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * One key per order in flight, reused if the same attempt is retried. Kept
   * in a ref rather than state: it is an implementation detail of talking to
   * the database, and changing it must never re-render the queue.
   */
  const keys = useRef<Record<string, string>>({});

  /**
   * Tickets with a payment write in flight.
   *
   * `isPending` is a render flag: two taps inside the same frame both read
   * `false` and both start a transition. The idempotency key makes the second
   * one harmless at the database, but "harmless" still means a second round
   * trip and a second voice in the room saying it worked. A ref is read at the
   * moment of the tap, which is the only place a double tap can be stopped.
   */
  const paying = useRef<Set<string>>(new Set());

  const live = Boolean(data);
  const blocked = data?.blocked;
  const queue: QueueRow[] = live
    ? (data?.queue ?? []).map(fromLive)
    : counterQueue
        .map(fromDemo)
        .filter((row) => !demoDone.includes(row.key));

  // A row being paid disappears at once: the cashier has the money in hand
  // and must not be able to take it twice. If the write fails the id comes
  // back off this list and the row returns with the error shown.
  const visible = queue.filter((row) => !settling.includes(row.key));
  // The selection follows the queue: when the chosen ticket is settled it
  // leaves, and the panel falls back to the oldest one still waiting, which
  // is where a cashier's attention goes next anyway.
  const order = visible.find((row) => row.key === selectedKey) ?? visible[0];
  /**
   * A bill can leave the queue between the ledger being drawn and the tap:
   * somebody at the counter settles it, or the kitchen cancels it.
   *
   * The panel still has to show something, so it falls back to the oldest
   * ticket -- but silently, that would look like the link went to the wrong
   * order, and at a real counter it could mean taking the wrong table's money.
   * So the fallback says out loud that it is a fallback.
   */
  const wanted = focus?.trim() || null;
  const focusMissing = Boolean(
    wanted &&
      !focusDismissed &&
      !visible.some((row) => row.key === wanted || row.code === wanted),
  );
  const outstanding = useMemo(
    () => visible.reduce((sum, item) => sum + item.outstanding, 0),
    [visible],
  );

  const recordPayment = () => {
    if (!order) return;
    if (paying.current.has(order.key)) return;
    paying.current.add(order.key);
    // Released in every exit path below; the sample path is synchronous, the
    // live one releases when the write answers.
    const release = () => paying.current.delete(order.key);
    setError('');
    setMessage('');

    // No database row means nothing can be written. In a preview that is
    // expected, so the row is settled in this browser only and the screen
    // says exactly that -- a disabled button with no explanation is how a
    // demo reads as broken.
    if (!order.orderId) {
      release();
      if (!live) {
        setDemoDone((current) => [...current, order.key]);
        setMessage(
          `${order.code} marked paid in this preview. Nothing was recorded and no money changed hands.`,
        );
        return;
      }
      setError('This ticket has no database id, so a payment cannot be recorded against it.');
      return;
    }

    const paidId = order.orderId;

    // Reuse the key if this exact attempt failed before, so a retry is
    // recognised as a retry instead of starting a second payment.
    if (!keys.current[paidId]) keys.current[paidId] = newIdempotencyKey();

    setSettling((current) => [...current, paidId]);

    startTransition(async () => {
      const result = await recordPaymentAction({
        orderId: paidId,
        method,
        idempotencyKey: keys.current[paidId],
      });

      release();

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

  /**
   * Cancel the selected order.
   *
   * Two taps, and the confirmation names what is being cancelled: at a busy
   * counter "Cancel" next to "Record cash" is one slip away from throwing
   * away a guest's order.
   *
   * The row leaves the queue immediately and the server is re-read, because a
   * cancelled order must not be settleable -- taking money for food that will
   * never arrive is the worst outcome this screen can produce.
   */
  const cancelOrder = async () => {
    if (!order) return;

    if (!order.orderId) {
      if (!live) {
        setDemoDone((current) => [...current, order.key]);
        setConfirmCancel(null);
        setMessage(`${order.code} cancelled in this preview. Nothing was recorded.`);
        return;
      }
      setError('This ticket has no database id, so it cannot be cancelled here.');
      return;
    }

    const id = order.orderId;

    if (confirmCancel !== id) {
      setConfirmCancel(id);
      return;
    }

    setError('');
    setMessage('');
    setCancelling(id);

    const result = await cancelStaffOrderAction({ orderId: id });

    setCancelling(null);
    setConfirmCancel(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSettling((current) => [...current, id]);
    setMessage(result.message);
    router.refresh();
  };

  const outstandingNote =
    visible.length === 1 ? '1 ticket awaiting payment' : `${visible.length} tickets awaiting payment`;

  return (
    <div data-surface="owner" className="min-h-dvh bg-paper text-gink antialiased">
      {nav}

      {/* The rail is 244px wide, and this screen used to offset by 232 -- so
          twelve pixels of the content column sat underneath it on every laptop.
          The number lives in one place (`OwnerPage`), and this screen cannot
          use `OwnerPage` because it is a Client Component whose nav is rendered
          by the server; the offset is therefore written here and pinned by a
          test. */}
      <div className="lg:pl-[244px]">
        <main className="mx-auto w-full max-w-[1180px] px-5 pt-6 pb-20 sm:px-7 lg:pt-9">
          <PageHead
            kicker={
              <span className="inline-flex items-center gap-1.5">
                <Dot tone={live ? 'live' : 'idle'} />
                {live ? 'Counter · open' : 'Counter · demo mode'}
              </span>
            }
            title={blocked ? 'The counter' : live ? data?.restaurantName || 'This restaurant' : restaurant.name}
            meta={
              blocked ? (
                'Payments can only be recorded by a signed-in member of staff.'
              ) : (
                <>
                  {outstandingNote}
                  <span className="mx-2 text-gink-28">·</span>
                  <span className="text-gink tabular-nums">{inr(outstanding)}</span> outstanding
                </>
              )
            }
            actions={
              !blocked ? (
                <BtnLink href="/dashboard/orders" tone="ghost" size="sm">
                  The ledger
                </BtnLink>
              ) : null
            }
          />

          {blocked && <SignInPrompt reason={blocked} screen="counter" />}

          {!blocked && (
            <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-start lg:gap-6">
              {/* -------------------------------------------------------- queue */}
              <section aria-labelledby="counter-queue">
                <SectionHead
                  title={<span id="counter-queue">Awaiting payment</span>}
                  meta={visible.length ? `${visible.length} open` : 'clear'}
                />
                {visible.length ? (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0" data-counter-queue>
                    {visible.map((item) => {
                      const selected = order?.key === item.key;
                      return (
                        <li key={item.key}>
                          <button
                            type="button"
                            data-counter-ticket
                            data-selected={selected ? 'true' : 'false'}
                            aria-pressed={selected}
                            aria-label={`Select ${item.code} at ${item.table}, ${inr(item.outstanding)} outstanding`}
                            onClick={() => {
                              setSelectedKey(item.key);
                              setConfirmCancel(null);
                              setError('');
                            }}
                            className={[
                              'o-choice w-full rounded-[var(--p-r-block)] px-4 py-3 text-left',
                              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]',
                            ].join(' ')}
                          >
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="flex items-baseline gap-2">
                                <strong className="text-[13.5px] font-semibold tracking-[-0.01em] text-gink">
                                  {item.code}
                                </strong>
                                <span className="text-[12.5px] text-gink-46">{item.table}</span>
                              </span>
                              <span className="text-[11.5px] text-gink-46 tabular-nums">{item.at}</span>
                            </span>

                            <span className="mt-1.5 block truncate text-[12.5px] leading-[1.45] text-gink-64">
                              {item.items}
                            </span>

                            <span className="mt-2.5 flex items-center justify-between gap-3">
                              <span className="flex flex-wrap items-center gap-1.5">
                                {item.claimed ? (
                                  <Tag tone="due">Says paid by UPI</Tag>
                                ) : null}
                                {/* The kitchen's own word for where the food is,
                                    as a status tag: the string was bare 11.5px
                                    grey text sitting beside two real tags. */}
                                <Tag tone="neutral">{item.state}</Tag>
                              </span>
                              <span className="text-[15px] font-semibold text-gink tabular-nums">
                                {/* Outstanding, not total: what the till actually
                                    wants, at the size a cashier reads across a
                                    counter. It was 13.5px next to a 13.5px code. */}
                                {inr(item.outstanding)}
                                {item.paid > 0 && (
                                  <span className="ml-1 text-[11.5px] font-normal text-gink-46">
                                    of {inr(item.total)}
                                  </span>
                                )}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Empty>
                    {live
                      ? 'No orders are waiting for payment.'
                      : 'No demo orders are waiting for payment.'}
                  </Empty>
                )}
              </section>

              {/* ------------------------------------------------------- detail */}
              {order ? (
                <section aria-labelledby="cashier-order-title" className="min-w-0">
                  {focusMissing ? (
                    <Notice
                      role="status"
                      className="mb-3"
                      action={
                        <button
                          type="button"
                          className={btn('ghost', 'sm')}
                          onClick={() => {
                            setFocusDismissed(true);
                            setSelectedKey(null);
                          }}
                        >
                          Got it
                        </button>
                      }
                    >
                      The bill you came for is not waiting any more — it was settled or cancelled
                      just now. This is the oldest ticket still open.
                    </Notice>
                  ) : null}

                  <Card>
                    {/* the amount is the one large thing on this screen */}
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hair px-5 py-5">
                      <div className="min-w-0">
                        <div className="text-[11.5px] font-medium tracking-[0.03em] text-gink-46">
                          Order {order.code} · {order.table}
                          {order.orderId ? (
                            <>
                              {' · '}
                              <Link
                                href={`/bill/${order.orderId}`}
                                className="text-gink underline decoration-hair-strong underline-offset-2 hover:decoration-gink"
                              >
                                bill
                              </Link>
                            </>
                          ) : null}
                        </div>
                        <h2
                          id="cashier-order-title"
                          className="mt-1.5 text-[clamp(2rem,3.4vw,2.6rem)] leading-none font-medium tracking-[-0.045em] text-gink tabular-nums"
                        >
                          {inr(order.outstanding)}
                        </h2>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <Tag tone="due">Payment due</Tag>
                        {order.claimed ? <Tag tone="work">Guest says paid by UPI</Tag> : null}
                      </div>
                    </div>

                    <div className="px-5 py-4">
                      {/**
                       * The claim is on the queue row, which is easy to miss once
                       * the ticket is selected -- and this panel is where the
                       * money gets recorded. Recording cash on a bill the guest
                       * has already paid by UPI collects it twice, so the panel
                       * repeats the claim and names the check to make.
                       */}
                      {order.claimed ? (
                        <Notice
                          data-claim
                          role="note"
                          tone="accent"
                          className="mb-3"
                          label={
                            <strong className="text-[12.5px] font-semibold text-gink">
                              The guest has marked this bill paid by UPI.
                            </strong>
                          }
                        >
                          Check the restaurant&rsquo;s own UPI app before recording it as cash
                          &mdash; nothing in this app can see that transfer.
                        </Notice>
                      ) : null}

                      {order.paid > 0 && (
                        <p className="mb-3 text-[12.5px] leading-[1.5] text-gink-64">
                          {inr(order.paid)} already recorded on this order, against a bill of{' '}
                          {inr(order.total)}. Take the remaining {inr(order.outstanding)}.
                        </p>
                      )}

                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        <li className="flex items-baseline justify-between gap-4 text-[13px] text-gink-64">
                          <span className="min-w-0">{order.items}</span>
                          <span className="shrink-0 tabular-nums">{inr(order.total)}</span>
                        </li>
                      </ul>
                      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-hair pt-3 text-[13px]">
                        <span className="font-medium text-gink">Outstanding</span>
                        <strong className="tabular-nums text-gink">{inr(order.outstanding)}</strong>
                      </div>

                      <div className="mt-5">
                        <div className="mb-1.5 text-[12.5px] font-medium text-gink-64">
                          Payment method
                        </div>
                        <Segmented
                          label="Payment method"
                          value={method}
                          onChange={setMethod}
                          options={COUNTER_METHODS.map((value) => ({
                            value,
                            label: COUNTER_METHOD_LABEL[value],
                          }))}
                        />
                      </div>

                      <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                        This records a counter payment. Nothing is charged here &mdash; the guest
                        pays on the terminal or by scanning the shop&rsquo;s code, and this writes
                        down that it happened.
                      </p>

                      {error && (
                        <Notice
                          role="alert"
                          tone="due"
                          className="mt-3 mb-0"
                          label={
                            <strong className="text-[12.5px] font-semibold text-gink">
                              Could not record the payment.
                            </strong>
                          }
                        >
                          {error}
                        </Notice>
                      )}

                      <button
                        type="button"
                        data-counter-cta
                        className={`${btn('primary')} mt-4 w-full`}
                        disabled={isPending || Boolean(live && !order.orderId)}
                        aria-busy={isPending}
                        onClick={recordPayment}
                      >
                        {isPending
                          ? 'Recording…'
                          : `Record ${method === 'cash' ? 'cash' : method.toUpperCase()} ${inr(order.outstanding)}`}
                      </button>
                      {/* A disabled button with no reason is the failure this
                          screen has already had once. If the ticket cannot be
                          paid, the screen says so under the button. */}
                      {live && !order.orderId && (
                        <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">
                          This ticket arrived without an id, so no payment can be recorded against
                          it. Ask the kitchen to re-send the order.
                        </p>
                      )}

                      {confirmCancel === order.orderId && order.orderId ? (
                        <div
                          role="group"
                          aria-label="Confirm cancellation"
                          className="mt-3 rounded-[var(--p-r-control)] border border-[var(--alert)]/30 bg-[var(--alert)]/6 px-3.5 py-3"
                        >
                          <strong className="text-[12.5px] text-gink">
                            Cancel {order.code} for {order.table}?
                          </strong>
                          <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-64">
                            Nothing is charged. The kitchen is told at once and the ticket leaves
                            this queue — this cannot be undone.
                          </p>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={btn('danger', 'sm')}
                              disabled={cancelling === order.orderId}
                              onClick={cancelOrder}
                            >
                              {cancelling === order.orderId ? 'Cancelling…' : 'Yes, cancel it'}
                            </button>
                            <button
                              type="button"
                              className={btn('ghost', 'sm')}
                              onClick={() => setConfirmCancel(null)}
                            >
                              Keep it
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`${btn('quiet', 'sm')} mt-1`}
                          disabled={isPending || Boolean(live && !order.orderId)}
                          onClick={cancelOrder}
                        >
                          Cancel this order
                        </button>
                      )}

                      {message && (
                        <Notice role="status" tone="live" className="mt-3 mb-0" label={<span className="text-[11.5px] font-semibold text-[var(--p-live)]">Recorded</span>}>
                          {message}
                        </Notice>
                      )}
                      {/* One footnote, not two saying the same thing: the
                          paragraph above already says nothing is charged. */}
                      <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">
                        {live
                          ? 'Every write here leaves an audit entry.'
                          : 'Preview only: nothing is persisted, and reloading this page brings the queue back.'}
                      </p>
                    </div>
                  </Card>
                </section>
              ) : (
                <section aria-live="polite" className="min-w-0">
                  <Panel title="Queue clear" meta={live ? 'all settled' : 'preview'}>
                    <p className="m-0 text-[13px] leading-[1.55] text-gink-64">
                      {live
                        ? 'Every order from the last day has been settled.'
                        : 'Every demo order in this preview has been settled.'}
                    </p>
                    {message && (
                      <p role="status" className="mt-3 text-[12.5px] leading-[1.5] text-gink-64">
                        {message}
                      </p>
                    )}
                    {error && (
                      <div
                        role="alert"
                        className="mt-3 rounded-[var(--p-r-control)] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-3.5 py-3 text-[12.5px] text-[var(--alert)]"
                      >
                        {error}
                      </div>
                    )}
                    {!live && demoDone.length > 0 && (
                      <button
                        type="button"
                        className={`${btn('ghost')} mt-4`}
                        onClick={() => {
                          setDemoDone([]);
                          setSettling([]);
                          setMessage('Demo queue reset. No real payments were recorded.');
                        }}
                      >
                        Reset demo queue
                      </button>
                    )}
                  </Panel>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
