'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { counterQueue, inr, restaurant } from '@/lib/demo-data';
import type { CashierScreenData, CounterOrder } from '@/lib/db/cashier-screen';
// Value import, so it comes from the database-free module. Importing
// COUNTER_METHODS from lib/db/cashier-screen would pull lib/supabase/server
// into the browser bundle -- type-only imports there are fine, this is not.
import {
  COUNTER_METHODS,
  COUNTER_METHOD_LABEL,
  SPLIT_METHODS,
  SPLIT_METHOD_LABEL,
  type CounterMethod,
  type SplitMethod,
} from '@/lib/payment-methods';
import {
  applyBillingAdjustmentAction,
  createCounterOrderAction,
  recordPaymentAction,
  recordRefundAction,
  recordSplitPaymentAction,
} from '@/app/(staff)/cashier/actions';
import { paiseToRupees } from '@/lib/money';
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
  channel?: string;
  subtotalPaise?: number;
  discountPaise?: number;
  discountReason?: string | null;
  isComplimentary?: boolean;
  serviceChargePaise?: number;
  packagingChargePaise?: number;
  deliveryChargePaise?: number;
  roundOffPaise?: number;
  taxPaise?: number;
  totalPaise?: number;
  paidPaise?: number;
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
    channel: order.channel,
    subtotalPaise: order.subtotalPaise,
    discountPaise: order.discountPaise,
    discountReason: order.discountReason,
    isComplimentary: order.isComplimentary,
    serviceChargePaise: order.serviceChargePaise,
    packagingChargePaise: order.packagingChargePaise,
    deliveryChargePaise: order.deliveryChargePaise,
    roundOffPaise: order.roundOffPaise,
    taxPaise: order.taxPaise,
    totalPaise: order.totalPaise,
    paidPaise: order.paidPaise,
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
  const [paymentReceiptUrl, setPaymentReceiptUrl] = useState<string | null>(null);
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

  // Billing Spec v2.0 counter POS panels
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [newChannel, setNewChannel] = useState<'dine_in' | 'takeaway' | 'delivery'>('dine_in');
  const [newTableId, setNewTableId] = useState(data?.tables?.[0]?.id ?? '');
  const [newLines, setNewLines] = useState<Array<{ itemId: string; variantId?: string; qty: number }>>([]);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newNote, setNewNote] = useState('');
  const [creatingOrder, setCreatingOrder] = useState(false);

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjDiscount, setAdjDiscount] = useState('');
  const [adjDiscountReason, setAdjDiscountReason] = useState('');
  const [adjService, setAdjService] = useState('');
  const [adjPackaging, setAdjPackaging] = useState('');
  const [adjDelivery, setAdjDelivery] = useState('');
  const [adjRoundOff, setAdjRoundOff] = useState(false);
  const [adjComplimentary, setAdjComplimentary] = useState(false);
  const [adjCompReason, setAdjCompReason] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<Array<{ method: SplitMethod; amountRupees: string; splitLabel: string }>>([
    { method: 'cash', amountRupees: '', splitLabel: '' },
    { method: 'upi', amountRupees: '', splitLabel: '' },
  ]);

  const [refundPaymentId, setRefundPaymentId] = useState(data?.refundablePayments?.[0]?.paymentId ?? '');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);

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
    setPaymentReceiptUrl(null);

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
      setPaymentReceiptUrl(result.paymentReceiptUrl ?? null);
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

  const canManageRefunds = data?.role === 'owner' || data?.role === 'manager';

  const openAdjustForOrder = () => {
    if (!order) return;
    setAdjDiscount(order.discountPaise ? String(paiseToRupees(order.discountPaise)) : '');
    setAdjDiscountReason(order.discountReason ?? '');
    setAdjService(order.serviceChargePaise ? String(paiseToRupees(order.serviceChargePaise)) : '');
    setAdjPackaging(order.packagingChargePaise ? String(paiseToRupees(order.packagingChargePaise)) : '');
    setAdjDelivery(order.deliveryChargePaise ? String(paiseToRupees(order.deliveryChargePaise)) : '');
    setAdjRoundOff(Boolean(order.roundOffPaise));
    setAdjComplimentary(Boolean(order.isComplimentary));
    setAdjCompReason('');
    setShowAdjust((prev) => !prev);
  };

  const submitCounterOrder = async () => {
    if (creatingOrder) return;
    setError('');
    setMessage('');
    setCreatingOrder(true);
    const res = await createCounterOrderAction({
      channel: newChannel,
      tableId: newChannel === 'dine_in' ? newTableId : null,
      lines: newLines,
      note: newNote,
      customerName: newCustomerName,
      customerPhone: newCustomerPhone,
    });
    setCreatingOrder(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessage(res.message);
    setNewLines([]);
    setNewNote('');
    setNewCustomerName('');
    setNewCustomerPhone('');
    setShowNewOrder(false);
    if (res.orderId) setSelectedKey(res.orderId);
    router.refresh();
  };

  const submitAdjustments = async () => {
    if (!order?.orderId || savingAdjust) return;
    setError('');
    setMessage('');
    setSavingAdjust(true);
    const res = await applyBillingAdjustmentAction({
      orderId: order.orderId,
      discountRupees: adjDiscount || '0',
      discountReason: adjDiscountReason,
      serviceChargeRupees: adjService || '0',
      packagingChargeRupees: adjPackaging || '0',
      deliveryChargeRupees: adjDelivery || '0',
      roundOff: adjRoundOff,
      isComplimentary: adjComplimentary,
      complimentaryReason: adjCompReason,
    });
    setSavingAdjust(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessage(res.message);
    setShowAdjust(false);
    router.refresh();
  };

  const submitSplitPayment = () => {
    if (!order?.orderId) return;
    if (paying.current.has(order.key)) return;
    paying.current.add(order.key);
    const release = () => paying.current.delete(order.key);
    setError('');
    setMessage('');
    setPaymentReceiptUrl(null);

    const paidId = order.orderId;
    if (!keys.current[paidId]) keys.current[paidId] = newIdempotencyKey();

    startTransition(async () => {
      const res = await recordSplitPaymentAction({
        orderId: paidId,
        splits,
        idempotencyKey: keys.current[paidId],
      });
      release();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      delete keys.current[paidId];
      setMessage(res.message);
      setSplitMode(false);
      router.refresh();
    });
  };

  const submitRefund = async () => {
    if (refundBusy || !refundPaymentId) return;
    setError('');
    setMessage('');
    setRefundBusy(true);
    const res = await recordRefundAction({
      paymentId: refundPaymentId,
      amountRupees: refundAmount,
      reason: refundReason,
      idempotencyKey: newIdempotencyKey(),
    });
    setRefundBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessage(res.message);
    setRefundAmount('');
    setRefundReason('');
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
                  <span className="text-gink tabular-nums">{inr(outstanding)}</span> outstanding
                </>
              )
            }
            actions={
              !blocked ? (
                <div className="flex flex-wrap items-center gap-2">
                  {live && (data?.menuItems?.length ?? 0) > 0 ? (
                    <button
                      type="button"
                      className={btn(showNewOrder ? 'solid' : 'ghost', 'sm')}
                      onClick={() => setShowNewOrder((prev) => !prev)}
                    >
                      {showNewOrder ? 'Close counter entry' : '+ New counter order'}
                    </button>
                  ) : null}
                  <BtnLink href="/dashboard/orders" tone="ghost" size="sm">
                    The ledger
                  </BtnLink>
                </div>
              ) : null
            }
          />

          {blocked && <SignInPrompt reason={blocked} screen="counter" />}

          {!blocked && live && showNewOrder && (data?.menuItems?.length ?? 0) > 0 ? (
            <Panel title="New counter order" meta="Dine-in · Takeaway · Delivery" className="mb-5">
              <div className="flex flex-wrap gap-2">
                {(['dine_in', 'takeaway', 'delivery'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setNewChannel(ch)}
                    className={btn(newChannel === ch ? 'solid' : 'ghost', 'sm')}
                  >
                    {ch === 'dine_in' ? 'Dine-in' : ch === 'takeaway' ? 'Takeaway' : 'Delivery'}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {newChannel === 'dine_in' ? (
                  <label className="text-[12.5px] text-gink-64">
                    Table
                    <select
                      value={newTableId}
                      onChange={(e) => setNewTableId(e.target.value)}
                      className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-paper px-2.5 py-2 text-[13px] text-gink"
                    >
                      {(data?.tables ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="text-[12.5px] text-gink-64">
                      Customer name (optional)
                      <input
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-paper px-2.5 py-2 text-[13px] text-gink"
                        placeholder="Guest name"
                      />
                    </label>
                    <label className="text-[12.5px] text-gink-64">
                      Phone (optional)
                      <input
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(e.target.value)}
                        className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-paper px-2.5 py-2 text-[13px] text-gink"
                        placeholder="10-digit mobile"
                      />
                    </label>
                  </>
                )}
                <label className="text-[12.5px] text-gink-64">
                  Kitchen / counter note (optional)
                  <input
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-paper px-2.5 py-2 text-[13px] text-gink"
                    placeholder="Extra spicy, pack separate…"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(data?.menuItems ?? []).slice(0, 24).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setNewLines((prev) => {
                        const existing = prev.find((l) => l.itemId === item.id && !l.variantId);
                        if (existing) {
                          return prev.map((l) =>
                            l.itemId === item.id && !l.variantId ? { ...l, qty: l.qty + 1 } : l,
                          );
                        }
                        return [...prev, { itemId: item.id, qty: 1 }];
                      })
                    }
                    className="rounded-full border border-hair bg-paper px-3 py-1 text-[12.5px] text-gink hover:border-hair-strong"
                  >
                    + {item.name} ({inr(paiseToRupees(item.pricePaise))})
                  </button>
                ))}
              </div>
              {newLines.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-3">
                  <div className="flex flex-wrap gap-2 text-[12.5px] text-gink">
                    {newLines.map((line) => {
                      const item = data?.menuItems?.find((m) => m.id === line.itemId);
                      return (
                        <span key={line.itemId} className="inline-flex items-center gap-1.5 rounded bg-paper-deep px-2 py-1">
                          {line.qty} × {item?.name ?? 'Item'}
                          <button
                            type="button"
                            className="text-gink-46 hover:text-gink"
                            onClick={() => setNewLines((prev) => prev.filter((l) => l.itemId !== line.itemId))}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className={btn('primary', 'sm')}
                    disabled={creatingOrder}
                    onClick={submitCounterOrder}
                  >
                    {creatingOrder ? 'Creating…' : 'Create counter order'}
                  </button>
                </div>
              ) : null}
            </Panel>
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
                        {order.pendingOnline ? <Tag tone="due">Online payment in progress</Tag> : null}
                      </div>
                    </div>

                    <div className="px-5 py-4">
                      {order.paid > 0 && (
                        <p className="mb-3 text-[12.5px] leading-[1.5] text-gink-64">
                          {inr(order.paid)} already recorded on this order, against a bill of{' '}
                          {inr(order.total)}. Take the remaining {inr(order.outstanding)}.
                        </p>
                      )}

                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        <li className="flex items-baseline justify-between gap-4 text-[13px] text-gink-64">
                          <span className="min-w-0">{order.items}</span>
                          <span className="shrink-0 tabular-nums">
                            {inr(paiseToRupees(order.subtotalPaise ?? Math.round(order.total * 100)))}
                          </span>
                        </li>
                        {(order.discountPaise ?? 0) > 0 ? (
                          <li className="flex items-baseline justify-between gap-4 text-[12.5px] text-gink-64">
                            <span>
                              Discount {order.discountReason ? `(${order.discountReason})` : ''}
                            </span>
                            <span className="tabular-nums">−{inr(paiseToRupees(order.discountPaise ?? 0))}</span>
                          </li>
                        ) : null}
                        {(order.serviceChargePaise ?? 0) > 0 ? (
                          <li className="flex items-baseline justify-between gap-4 text-[12.5px] text-gink-64">
                            <span>Service charge</span>
                            <span className="tabular-nums">{inr(paiseToRupees(order.serviceChargePaise ?? 0))}</span>
                          </li>
                        ) : null}
                        {(order.packagingChargePaise ?? 0) > 0 ? (
                          <li className="flex items-baseline justify-between gap-4 text-[12.5px] text-gink-64">
                            <span>Packaging charge</span>
                            <span className="tabular-nums">{inr(paiseToRupees(order.packagingChargePaise ?? 0))}</span>
                          </li>
                        ) : null}
                        {(order.deliveryChargePaise ?? 0) > 0 ? (
                          <li className="flex items-baseline justify-between gap-4 text-[12.5px] text-gink-64">
                            <span>Delivery charge</span>
                            <span className="tabular-nums">{inr(paiseToRupees(order.deliveryChargePaise ?? 0))}</span>
                          </li>
                        ) : null}
                        {(order.roundOffPaise ?? 0) !== 0 ? (
                          <li className="flex items-baseline justify-between gap-4 text-[12.5px] text-gink-64">
                            <span>Round-off</span>
                            <span className="tabular-nums">
                              {(order.roundOffPaise ?? 0) > 0 ? '+' : '−'}
                              {inr(paiseToRupees(Math.abs(order.roundOffPaise ?? 0)))}
                            </span>
                          </li>
                        ) : null}
                      </ul>
                      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-hair pt-3 text-[13px]">
                        <span className="font-medium text-gink">Outstanding</span>
                        <strong className="tabular-nums text-gink">{inr(order.outstanding)}</strong>
                      </div>

                      {live && order.orderId && order.paid === 0 ? (
                        <div className="mt-3">
                          <button
                            type="button"
                            className={btn('ghost', 'sm')}
                            onClick={openAdjustForOrder}
                          >
                            {showAdjust ? 'Hide bill adjustments' : 'Discount / charges / complimentary'}
                          </button>
                          {showAdjust ? (
                            <div className="mt-2.5 grid gap-2.5 rounded-[var(--p-r-control)] border border-hair bg-paper-deep p-3 sm:grid-cols-2">
                              <label className="text-[11.5px] text-gink-64">
                                Discount (₹)
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={adjDiscount}
                                  onChange={(e) => setAdjDiscount(e.target.value)}
                                  className="mt-1 w-full rounded border border-hair bg-paper px-2 py-1.5 text-[12.5px] text-gink"
                                />
                              </label>
                              <label className="text-[11.5px] text-gink-64">
                                Discount reason
                                <input
                                  type="text"
                                  value={adjDiscountReason}
                                  onChange={(e) => setAdjDiscountReason(e.target.value)}
                                  placeholder="e.g. Regular guest 10%"
                                  className="mt-1 w-full rounded border border-hair bg-paper px-2 py-1.5 text-[12.5px] text-gink"
                                />
                              </label>
                              <label className="text-[11.5px] text-gink-64">
                                Service charge (₹)
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={adjService}
                                  onChange={(e) => setAdjService(e.target.value)}
                                  className="mt-1 w-full rounded border border-hair bg-paper px-2 py-1.5 text-[12.5px] text-gink"
                                />
                              </label>
                              <label className="text-[11.5px] text-gink-64">
                                Packaging (₹)
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={adjPackaging}
                                  onChange={(e) => setAdjPackaging(e.target.value)}
                                  className="mt-1 w-full rounded border border-hair bg-paper px-2 py-1.5 text-[12.5px] text-gink"
                                />
                              </label>
                              <label className="text-[11.5px] text-gink-64">
                                Delivery (₹)
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={adjDelivery}
                                  onChange={(e) => setAdjDelivery(e.target.value)}
                                  className="mt-1 w-full rounded border border-hair bg-paper px-2 py-1.5 text-[12.5px] text-gink"
                                />
                              </label>
                              <label className="flex items-center gap-2 self-end pb-1.5 text-[12.5px] text-gink">
                                <input
                                  type="checkbox"
                                  checked={adjRoundOff}
                                  onChange={(e) => setAdjRoundOff(e.target.checked)}
                                />
                                Auto round-off to ₹1
                              </label>
                              {canManageRefunds ? (
                                <div className="sm:col-span-2 flex flex-wrap items-center gap-2 border-t border-hair pt-2">
                                  <label className="flex items-center gap-2 text-[12.5px] text-gink">
                                    <input
                                      type="checkbox"
                                      checked={adjComplimentary}
                                      onChange={(e) => setAdjComplimentary(e.target.checked)}
                                    />
                                    Mark complimentary (₹0)
                                  </label>
                                  {adjComplimentary ? (
                                    <input
                                      type="text"
                                      value={adjCompReason}
                                      onChange={(e) => setAdjCompReason(e.target.value)}
                                      placeholder="Reason (required)"
                                      className="flex-1 rounded border border-hair bg-paper px-2 py-1 text-[12.5px] text-gink"
                                    />
                                  ) : null}
                                </div>
                              ) : null}
                              <div className="sm:col-span-2">
                                <button
                                  type="button"
                                  className={btn('solid', 'sm')}
                                  disabled={savingAdjust}
                                  onClick={submitAdjustments}
                                >
                                  {savingAdjust ? 'Applying…' : 'Apply adjustments'}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-5">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-[12.5px] font-medium text-gink-64">Payment method</span>
                          {live && order.orderId ? (
                            <button
                              type="button"
                              className="text-[11.5px] font-medium text-gink underline decoration-hair-strong underline-offset-2"
                              onClick={() => setSplitMode((prev) => !prev)}
                            >
                              {splitMode ? 'Single full payment' : 'Split / partial pay'}
                            </button>
                          ) : null}
                        </div>
                        {!splitMode ? (
                          <Segmented
                            label="Payment method"
                            value={method}
                            onChange={setMethod}
                            options={COUNTER_METHODS.map((value) => ({
                              value,
                              label: COUNTER_METHOD_LABEL[value],
                            }))}
                          />
                        ) : (
                          <div className="flex flex-col gap-2 rounded-[var(--p-r-control)] border border-hair bg-paper-deep p-3">
                            {splits.map((s, idx) => (
                              <div key={idx} className="flex flex-wrap items-center gap-2">
                                <select
                                  value={s.method}
                                  onChange={(e) =>
                                    setSplits((prev) =>
                                      prev.map((row, i) =>
                                        i === idx ? { ...row, method: e.target.value as SplitMethod } : row,
                                      ),
                                    )
                                  }
                                  className="rounded border border-hair bg-paper px-2 py-1.5 text-[12.5px] text-gink"
                                >
                                  {SPLIT_METHODS.map((m) => (
                                    <option key={m} value={m}>
                                      {SPLIT_METHOD_LABEL[m]}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  step="0.01"
                                  placeholder="₹ amount"
                                  value={s.amountRupees}
                                  onChange={(e) =>
                                    setSplits((prev) =>
                                      prev.map((row, i) =>
                                        i === idx ? { ...row, amountRupees: e.target.value } : row,
                                      ),
                                    )
                                  }
                                  className="w-28 rounded border border-hair bg-paper px-2 py-1.5 text-[12.5px] text-gink tabular-nums"
                                />
                                <input
                                  type="text"
                                  placeholder="Label (e.g. Guest A)"
                                  value={s.splitLabel}
                                  onChange={(e) =>
                                    setSplits((prev) =>
                                      prev.map((row, i) =>
                                        i === idx ? { ...row, splitLabel: e.target.value } : row,
                                      ),
                                    )
                                  }
                                  className="min-w-0 flex-1 rounded border border-hair bg-paper px-2 py-1.5 text-[12.5px] text-gink"
                                />
                                {splits.length > 1 ? (
                                  <button
                                    type="button"
                                    className="text-[12.5px] text-gink-46 hover:text-gink"
                                    onClick={() => setSplits((prev) => prev.filter((_, i) => i !== idx))}
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </div>
                            ))}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <button
                                type="button"
                                className={btn('ghost', 'sm')}
                                onClick={() =>
                                  setSplits((prev) =>
                                    prev.length < 10
                                      ? [...prev, { method: 'cash', amountRupees: '', splitLabel: '' }]
                                      : prev,
                                  )
                                }
                              >
                                + Add split
                              </button>
                              <button
                                type="button"
                                className={btn('primary', 'sm')}
                                disabled={isPending}
                                onClick={submitSplitPayment}
                              >
                                {isPending ? 'Recording…' : 'Record split / partial payment'}
                              </button>
                            </div>
                          </div>
                        )}
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
                        disabled={isPending || order.pendingOnline || Boolean(live && !order.orderId)}
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
                              disabled={order.pendingOnline || cancelling === order.orderId}
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
                          disabled={isPending || order.pendingOnline || Boolean(live && !order.orderId)}
                          onClick={cancelOrder}
                        >
                          Cancel this order
                        </button>
                      )}

                      {message && (
                        <Notice role="status" tone="live" className="mt-3 mb-0" label={<span className="text-[11.5px] font-semibold text-[var(--p-live)]">Recorded</span>}>
                          {message}
                          {paymentReceiptUrl ? (
                            <Link href={paymentReceiptUrl} className="ml-2 font-medium underline decoration-hair-strong underline-offset-2">
                              View payment receipt
                            </Link>
                          ) : null}
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
                        className="mt-3 rounded-[var(--p-r-control)] border border-[var(--p-due)]/30 bg-[var(--p-due)]/8 px-3.5 py-3 text-[12.5px] text-[var(--p-due)]"
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

          {!blocked && live && canManageRefunds && (data?.refundablePayments?.length ?? 0) > 0 ? (
            <Panel title="Refunds (owner / manager)" meta="last 24h" className="mt-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-[12.5px] text-gink-64">
                  Settled payment
                  <select
                    value={refundPaymentId}
                    onChange={(e) => setRefundPaymentId(e.target.value)}
                    className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-paper px-2.5 py-2 text-[12.5px] text-gink"
                  >
                    {(data?.refundablePayments ?? []).map((p) => (
                      <option key={p.paymentId} value={p.paymentId}>
                        {p.orderCode} ({p.table}) · {p.method.toUpperCase()} {inr(paiseToRupees(p.refundablePaise))}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12.5px] text-gink-64">
                  Refund amount (₹)
                  <input
                    type="number"
                    min={1}
                    step="0.01"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    placeholder="e.g. 120"
                    className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-paper px-2.5 py-2 text-[12.5px] text-gink tabular-nums"
                  />
                </label>
                <label className="text-[12.5px] text-gink-64">
                  Refund reason
                  <input
                    type="text"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Item out of stock / customer dispute"
                    className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-paper px-2.5 py-2 text-[12.5px] text-gink"
                  />
                </label>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className={btn('danger', 'sm')}
                  disabled={refundBusy}
                  onClick={submitRefund}
                >
                  {refundBusy ? 'Recording refund…' : 'Record audited refund'}
                </button>
              </div>
            </Panel>
          ) : null}
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
