'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { counterQueue, restaurant } from '@/lib/demo-data';
import { formatBillMoney } from '@/lib/bill';
import { rupeesToPaise } from '@/lib/money';
import type { CashierScreenData, CounterOrder } from '@/lib/db/cashier-screen';
// Value import, so it comes from the database-free module. Importing
// COUNTER_METHODS from lib/db/cashier-screen would pull lib/supabase/server
// into the browser bundle -- type-only imports there are fine, this is not.
import { COUNTER_METHODS, COUNTER_METHOD_LABEL, type CounterMethod } from '@/lib/payment-methods';
import { counterAttemptKey, COUNTER_ID, readCounterAttempt, type CounterAttempt } from '@/lib/counter-attempt';
import { recordPaymentAction } from '@/app/(staff)/cashier/actions';
import { cancelStaffOrderAction } from '@/app/orders/actions';
import { SignInPrompt } from '@/components/SignInPrompt';
import { useInStaffShell } from '@/components/owner/StaffShell';
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

/** The queue's display shape uses rupees; never round away the saved paise at the till. */
const counterMoney = (rupees: number) => formatBillMoney(rupeesToPaise(rupees)).replace(/\.00$/, '');

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
  pendingOnline: boolean;
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
    pendingOnline: false,
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
    pendingOnline: order.pendingOnline === true,
  };
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
  const [paymentReceiptUrl, setPaymentReceiptUrl] = useState<string | null>(null);
  const [checkTicketUrl, setCheckTicketUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [settling, setSettling] = useState<string[]>([]);
  /** Orders settled or cancelled locally, in demo mode only. */
  const [demoDone, setDemoDone] = useState<string[]>([]);
  /** Which ticket the cashier is looking at. Null means "the oldest one". */
  const [selectedKey, setSelectedKey] = useState<string | null>(focus?.trim() || null);
  /** Has the cashier dismissed the note about a bill that is no longer waiting? */
  const [focusDismissed, setFocusDismissed] = useState(false);
  // Preserve the screen through a refresh after pinning a payment, but
  // follow an explicit new focus (for example, Collect from the ledger).
  useEffect(() => {
    setSelectedKey(focus?.trim() || null);
    setFocusDismissed(false);
  }, [focus]);
  /** The order the cashier has asked to cancel, before they confirm. */
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [stored, setStored] = useState<{ key: string; attempt?: CounterAttempt | null } | null>(null);
  // An immediate guard, independent of React's render schedule.
  const paying = useRef<Set<string>>(new Set());

  const live = Boolean(data);
  const blocked = data?.blocked;
  const queue: QueueRow[] = live
    ? (data?.queue ?? []).map(fromLive)
    : counterQueue
        .map(fromDemo)
        .filter((row) => !demoDone.includes(row.key));

  // Only verified writes remove rows optimistically. If the selected ticket
  // leaves the queue, no other ticket may inherit its payment button.
  const visible = queue.filter((row) => !settling.includes(row.key));
  const wanted = selectedKey ?? (focusDismissed ? null : focus?.trim() || null);
  const selected = visible.find(row => row.key === wanted || (!live && row.code === wanted));
  const order = selected ?? visible[0];
  const focusMissing = Boolean(wanted && !selected);
  const recordingId = focusMissing ? wanted : order?.orderId;
  const key = data?.outletId && data.canPlaceDirect && recordingId && COUNTER_ID.test(recordingId)
    ? counterAttemptKey(data.outletId, recordingId) : null;
  const activeStorage = stored?.key === key ? stored : null;
  const savedAttempt = activeStorage?.attempt;
  useEffect(() => {
    if (!key) return;
    const sync = () => {
      try {
        if (!navigator.locks || !crypto.randomUUID) throw new Error('Counter recording needs safe browser storage');
        setStored({ key, attempt: readCounterAttempt(window.localStorage, key) });
      } catch { setStored({ key }); }
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('pageshow', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('pageshow', sync); };
  }, [key]);

  const outstanding = useMemo(
    () => visible.reduce((sum, item) => sum + item.outstanding, 0),
    [visible],
  );

  const recordPayment = (reconcileOnly = false) => {
    if (!live) {
      if (!order || focusMissing) return;
      setDemoDone(current => [...current, order.key]);
      setSelectedKey(null);
      setFocusDismissed(true);
      setMessage(`${order.code} marked paid in this preview. Nothing was recorded and no money changed hands.`);
      return;
    }
    if (!recordingId || !key || savedAttempt === undefined || (focusMissing && !reconcileOnly)) return;
    if (paying.current.has(recordingId)) return;
    paying.current.add(recordingId);
    const storageKey = key;
    const ticketId = recordingId;
    setSelectedKey(ticketId);
    setError('');
    setMessage('');
    setPaymentReceiptUrl(null);
    setCheckTicketUrl(null);

    startTransition(async () => {
      const checkTicket = () => { setCheckTicketUrl(`/bill/${ticketId}`); router.refresh(); };
      const send = async () => {
        const storage = window.localStorage;
        const prior = readCounterAttempt(storage, storageKey);
        if (prior?.idempotencyKey !== savedAttempt?.idempotencyKey ||
            prior?.method !== savedAttempt?.method || prior?.amountPaise !== savedAttempt?.amountPaise) {
          setStored({ key: storageKey, attempt: prior });
          setError('The saved recording changed in another tab. Check the terminal or cash and saved ticket before continuing.');
          checkTicket();
          return;
        }
        const amountPaise = order ? rupeesToPaise(order.outstanding) : 0;
        if (!prior && (reconcileOnly || !order || amountPaise <= 0)) return;
        const attempt = prior ?? { method, amountPaise, idempotencyKey: crypto.randomUUID() };
        if (!prior) {
          storage.setItem(storageKey, JSON.stringify(attempt));
          if (readCounterAttempt(storage, storageKey)?.idempotencyKey !== attempt.idempotencyKey) {
            throw new Error('Could not retain a recording key');
          }
        }
        // An unacknowledged payment may already remove this ticket from the
        // queue. Reload or Back must still lead to this exact recording.
        const url = new URL(window.location.href);
        if (url.searchParams.get('order') !== ticketId) {
          url.searchParams.set('order', ticketId);
          window.history.replaceState(null, '', url);
        }
        setStored({ key: storageKey, attempt });
        const checkOnly = reconcileOnly || amountPaise !== attempt.amountPaise || order?.pendingOnline;
        const result = await recordPaymentAction({ orderId: ticketId, ...attempt, checkOnly });
        if (!result.ok) {
          // Even if the write was refused, tender may already have moved
          // outside the app. Keep the original attempt across reloads.
          setError(result.error);
          checkTicket();
          return;
        }
        try { storage.removeItem(storageKey); } catch { /* the saved payment was verified */ }
        setStored({ key: storageKey, attempt: null });
        setSettling(current => [...current, ticketId]);
        setMessage(result.message);
        setPaymentReceiptUrl(result.paymentReceiptUrl ?? null);
        router.refresh();
      };
      try {
        if (!navigator.locks) throw new Error('Counter recording needs safe browser storage');
        await navigator.locks.request(storageKey, { ifAvailable: true }, async lock => {
          if (!lock) {
            setError('Another tab is checking this ticket. Do not collect again; check the saved ticket before continuing.');
            checkTicket();
            return;
          }
          await send();
        });
      } catch {
        setError('Recording could not be verified. Check the saved ticket and the terminal or cash. Do not collect again until reconciled.');
        checkTicket();
      } finally { paying.current.delete(ticketId); }
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
    if (!order || focusMissing || (live && (!activeStorage || savedAttempt !== null))) return;

    /* Two taps for EVERY ticket, sample rows included.
     *
     * The confirmation below is the slip guard ("Cancel" next to "Record
     * cash" is one mistake away from throwing away a guest's order), and it
     * used to be skipped entirely for demo rows: they have no database id,
     * and the id-keyed guard came after the demo branch — so one stray tap
     * cancelled a sample ticket with nothing named and nothing asked. The
     * kitchen board has always confirmed before cancelling its sample
     * tickets; the counter now matches, keyed on the id where there is one
     * and the row's own key where there is not. */
    const cancelTarget = order.orderId ?? order.key;
    if (confirmCancel !== cancelTarget) {
      setConfirmCancel(cancelTarget);
      return;
    }

    if (!order.orderId) {
      if (!live) {
        setDemoDone((current) => [...current, order.key]);
        setSelectedKey(null);
        setFocusDismissed(true);
        setConfirmCancel(null);
        setMessage(`${order.code} cancelled in this preview. Nothing was recorded.`);
        return;
      }
      setConfirmCancel(null);
      setError('This ticket has no database id, so it cannot be cancelled here.');
      return;
    }

    const id = order.orderId;

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

  // Is the rail already on screen, rendered by the staff layout?
  const inShell = useInStaffShell();

  /*
   * INSIDE THE SHELL OR ON ITS OWN.
   *
   * The counter is a Client Component that cannot import `DashboardBar` -- the
   * bar carries a server action for sign-out -- so its page renders the bar and
   * hands it down as `nav`. Since the staff layout now renders the shell once,
   * THIS screen must not render a second one: when the shell is above it, the
   * frame is already there, `nav` is already drawn, and this returns the
   * content with the counter's own narrower column.
   *
   * The 244px offset used to live here as well as in `OwnerPage`, which is how
   * the two drifted to 232 and 244 and put twelve pixels of the page underneath
   * the rail. There is now one frame in the application, so there is one
   * number.
   */
  const content = (
    <div className="mx-auto w-full max-w-[1180px] px-5 pt-6 pb-20 sm:px-7 lg:pt-9">
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
                  <span className="text-gink tabular-nums">{counterMoney(outstanding)}</span> outstanding
                </>
              )
            }
            actions={
              !blocked ? (
                <>
                  {data?.canPlaceDirect && <BtnLink href="/dashboard/direct-order" tone="ghost" size="sm">New takeaway or delivery</BtnLink>}
                <BtnLink href="/dashboard/orders" tone="ghost" size="sm">
                  The ledger
                </BtnLink>
                </>
              ) : null
            }
          />

          {!blocked && data?.floor && <p data-counter-floor className="mb-3 text-[12.5px] text-gink-64">
            {data.floor.occupied} occupied · {data.floor.openCalls} open waiter calls{data.floor.truncated ? ' (partial floor)' : ''}{' '}
            <Link className="underline underline-offset-2" href="/waiter">View floor service</Link>
          </p>}
          {blocked && <SignInPrompt reason={blocked} screen="counter" />}

          {!blocked && message ? <Notice role="status" tone="live" className="mb-3">
            {message}
            {paymentReceiptUrl ? <Link href={paymentReceiptUrl} className="ml-2 font-medium underline underline-offset-2">View payment receipt</Link> : null}
          </Notice> : null}
          {!blocked && error ? <Notice role="alert" tone="due" className="mb-3">
            {error}
            {checkTicketUrl ? <Link href={checkTicketUrl} className="ml-2 font-medium underline underline-offset-2">Check saved ticket</Link> : null}
          </Notice> : null}

          {!blocked && focusMissing && wanted && COUNTER_ID.test(wanted) ? (
            <Notice className="mb-3">This ticket is no longer in the counter queue.{' '}
              <Link href={`/bill/${wanted}`} className="font-medium underline underline-offset-2">Check saved ticket</Link>
              {savedAttempt && <button type="button" className={`${btn('quiet', 'sm')} ml-2`} disabled={isPending} onClick={() => recordPayment(true)}>
                Check original recording
              </button>}
            </Notice>
          ) : null}

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
                            disabled={isPending}
                            aria-label={`Select ${item.code} at ${item.table}, ${counterMoney(item.outstanding)} outstanding`}
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
                                {/* The kitchen's own word for where the food is,
                                    as a status tag: the string was bare 11.5px
                                    grey text sitting beside two real tags. */}
                                <Tag tone="neutral">{item.state}</Tag>
                              </span>
                              <span className="text-[15px] font-semibold text-gink tabular-nums">
                                {/* Outstanding, not total: what the till actually
                                    wants, at the size a cashier reads across a
                                    counter. It was 13.5px next to a 13.5px code. */}
                                {counterMoney(item.outstanding)}
                                {item.paid > 0 && (
                                  <span className="ml-1 text-[11.5px] font-normal text-gink-46">
                                    of {counterMoney(item.total)}
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
                {/* The rehearsal reset belongs to the QUEUE, not to the empty
                    state: a sample settle is undoable while tickets remain,
                    not only after the last one. Rendered only while the queue
                    still has rows, so it never competes with the copy in the
                    "Queue clear" panel (same action, one at a time). */}
                {!live && visible.length > 0 && demoDone.length > 0 && (
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
                      The bill you came for is not waiting any more. Check its saved ticket before collecting payment.
                      {' '}This is the oldest ticket still open.
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
                          {counterMoney(order.outstanding)}
                        </h2>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <Tag tone="due">Payment due</Tag>
                        {order.pendingOnline ? <Tag tone="due">Online payment in progress</Tag> : null}
                      </div>
                    </div>

                    <div className="px-5 py-4">
                      {order.paid > 0 && (
                        <p className="mb-3 text-[12.5px] leading-[1.5] text-gink-64">
                          {counterMoney(order.paid)} already recorded on this order, against a bill of{' '}
                          {counterMoney(order.total)}. Take the remaining {counterMoney(order.outstanding)}.
                        </p>
                      )}

                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        <li className="flex items-baseline justify-between gap-4 text-[13px] text-gink-64">
                          <span className="min-w-0">{order.items}</span>
                          <span className="shrink-0 tabular-nums">{counterMoney(order.total)}</span>
                        </li>
                      </ul>
                      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-hair pt-3 text-[13px]">
                        <span className="font-medium text-gink">Outstanding</span>
                        <strong className="tabular-nums text-gink">{counterMoney(order.outstanding)}</strong>
                      </div>

                      {savedAttempt && !focusMissing ? (
                        <Notice className="mt-5">This device saved a {COUNTER_METHOD_LABEL[savedAttempt.method]} recording for {formatBillMoney(savedAttempt.amountPaise)}.
                          Do not collect again. Check the saved ticket and the terminal or cash before retrying the original recording.</Notice>
                      ) : <div className="mt-5">
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
                      </div>}

                      <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
                        Record only after counting the cash or verifying the exact amount on your terminal or UPI app.
                        Nothing is charged or verified by a provider here.
                      </p>

                      <button
                        type="button"
                        data-counter-cta
                        className={`${btn('primary')} mt-4 w-full`}
                        disabled={isPending || focusMissing || order.pendingOnline || Boolean(live && savedAttempt === undefined)}
                        aria-busy={isPending}
                        onClick={() => recordPayment()}
                      >
                        {isPending
                          ? 'Recording…'
                          : savedAttempt && !focusMissing
                            ? (rupeesToPaise(order.outstanding) === savedAttempt.amountPaise ? 'Retry original recording' : 'Check original recording')
                            : `Record ${method === 'cash' ? 'cash' : method.toUpperCase()} ${counterMoney(order.outstanding)}`}
                      </button>
                      {/* A disabled button with no reason is the failure this
                          screen has already had once. If the ticket cannot be
                          paid, the screen says so under the button. */}
                      {live && !focusMissing && savedAttempt === undefined && (
                        <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">
                          {!order.orderId ? 'This ticket arrived without an id. It cannot accept a recording.'
                            : 'Counter access and available browser storage are required to record payment. If a recording is unresolved, check with a manager before collecting.'}
                        </p>
                      )}

                      {confirmCancel === (order.orderId ?? order.key) ? (
                        <div
                          role="group"
                          aria-label="Confirm cancellation"
                          className="mt-3 rounded-[var(--p-r-control)] border border-[var(--p-due)]/30 bg-[var(--p-due)]/6 px-3.5 py-3"
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
                              disabled={order.pendingOnline || cancelling === order.orderId || Boolean(live && savedAttempt !== null)}
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
                          disabled={isPending || focusMissing || order.pendingOnline || Boolean(live && savedAttempt !== null)}
                          onClick={cancelOrder}
                        >
                          Cancel this order
                        </button>
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
                        ? 'No tickets are waiting for recording in this queue. Check the saved ticket to verify an earlier payment.'
                        : 'Every demo order in this preview has been settled.'}
                    </p>

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
    </div>
  );

  if (inShell) return content;

  return (
    <div data-surface="owner" className="min-h-dvh bg-paper text-gink antialiased">
      {nav}
      <div className="lg:pl-[244px]">{content}</div>
    </div>
  );
}
