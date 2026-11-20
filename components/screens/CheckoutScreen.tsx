'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { DishPhoto } from '@/components/DishPhoto';
import { GuestFlow } from '@/components/GuestFlow';
import { guestBrandStyle, type GuestBrandState } from '@/lib/branding/guest-theme';
import { PlaceOrderButton } from '@/components/PlaceOrderButton';
import { checkoutAttemptKey, finishCheckoutAttempt, readCheckoutAttempt, sameCheckoutCart, saveCheckoutAttempt, type CheckoutAttempt } from '@/lib/checkout-attempt';
import { cartKey, parseCart } from '@/lib/cart-storage';
import { useCart } from '@/components/CartProvider';
import { VegMark } from '@/components/ui';
import { formatQuoteMoney, priceCart, type MenuItemPrice } from '@/lib/cart-pricing';
import { placeOrderAction } from '@/app/menu/checkout/actions';
import { quoteTaxLabel, type TaxTreatment } from '@/lib/pricing';

/**
 * Checkout.
 *
 * One path: save an order for this table and pay the cashier at the counter. Online
 * payment used to be mentioned here as something offered after placing; it is
 * gone from customer ordering, so this screen says the one thing that will
 * happen and what comes next.
 */
export function Checkout({
  brandState,
  slug,
  restaurantName,
  tableLabel,
  tableId,
  taxRateBps,
  taxTreatment,
  items,
}: {
  brandState?: GuestBrandState | null;
  slug?: string;
  restaurantName?: string;
  /** The table a live session confirmed, when there is one. */
  tableLabel?: string | null;
  tableId?: string;
  /** The restaurant's own rate. Without it the bill is priced at a sample. */
  taxRateBps?: number;
  taxTreatment?: TaxTreatment;
  items: MenuItemPrice[];
}) {
  const paint = guestBrandStyle(brandState);
  const cart = useCart();
  const router = useRouter();
  const cartSlug = slug || 'demo';
  const key = checkoutAttemptKey(cartSlug, tableId ?? 'demo');
  const [pendingAttempt, setPendingAttempt] = useState<CheckoutAttempt | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const recovery = Boolean(pendingAttempt);
  const [notice, setNotice] = useState('');
  const submitting = useRef(false);
  useEffect(() => {
    const sync = () => {
      try {
        setPendingAttempt(readCheckoutAttempt(window.localStorage, key));
        if (!navigator.locks || !crypto.randomUUID) throw new Error('Checkout needs safe shared storage');
        setStorageBlocked(false);
      } catch {
        setStorageBlocked(true);
        setNotice('This browser cannot safely save or retry an order. Ask staff to take it, or check the earlier attempt before placing another.');
      }
    };
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('pageshow', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('pageshow', sync); };
  }, [key]);
  const priced = priceCart(pendingAttempt?.lines ?? cart.lines, items, taxRateBps, taxTreatment);
  const { subtotalPaise, taxPaise, totalPaise } = priced.totals;

  const withSlug = (path: string) => (slug ? `${path}?s=${encodeURIComponent(slug)}` : path);
  const needsReview = priced.missingIds.length > 0 || priced.unavailableIds.length > 0 ||
    priced.staleVariantIds.length > 0 || priced.staleAddonIds.length > 0;
  const canOrder = cart.ready && !storageBlocked && (recovery || (priced.lines.length > 0 && !needsReview));

  async function submit(form: FormData) {
    if (submitting.current || !canOrder || !navigator.locks) return;
    submitting.current = true;
    setNotice('');
    const send = async () => {
      const storage = window.localStorage;
      let attempt = readCheckoutAttempt(storage, key);
      const note = String(form.get('note') ?? '').trim().slice(0, 300);
      if (recovery ? attempt?.token !== pendingAttempt?.token
                   : attempt && (!sameCheckoutCart(attempt.lines, cart.lines) || attempt.note !== note)) {
        setPendingAttempt(attempt);
        setNotice('Checkout changed in another tab. Review this screen before retrying.');
        return;
      }
      if (!attempt) {
        const current = parseCart(storage.getItem(cartKey(cartSlug)));
        if (!sameCheckoutCart(current, cart.lines) || current.length === 0) {
          setNotice('Your cart changed in another tab. Review it before placing an order.');
          return;
        }
        attempt = { token: crypto.randomUUID(), lines: current, note };
        saveCheckoutAttempt(storage, key, attempt);
      }
      setPendingAttempt(attempt);
      form.set('attempt', attempt.token);
      form.set('lines', JSON.stringify(attempt.lines));
      form.set('note', attempt.note);
      const result = await placeOrderAction(form);
      if (result.kind === 'placed') {
        // Save the returned reference and consume the submitted cart before
        // navigation. If a different cart was built meanwhile, leave it alone.
        const submitted = attempt;
        await navigator.locks.request(cartKey(cartSlug), () => finishCheckoutAttempt(storage, cartSlug, key, submitted, result.code));
        cart.sync();
        setPendingAttempt(null);
        router.replace(result.href);
      } else if (result.kind === 'refused') {
        if (!result.keepAttempt && readCheckoutAttempt(storage, key)?.token === attempt.token) {
          storage.removeItem(key);
          setPendingAttempt(null);
        }
        router.replace(result.href);
      } else {
        setNotice('We could not confirm that order. Retry the same order here, or ask staff to check it before placing another. Nothing was charged online.');
      }
    };
    try {
      // Multiple open tabs in this browser share the pending attempt. The
      // losing tab re-reads storage *after* the first one resolves.
      // A check-then-set in localStorage is not a lock. Older browsers
      // that cannot coordinate tabs must use staff checkout, not two keys.
      await navigator.locks.request(key, send);
    } catch {
      setNotice('We could not confirm that order. Keep this cart and check with staff, or retry the same order if offered here. Nothing was charged online.');
    } finally { submitting.current = false; }
  }
  /**
   * The count in the header, from the priced cart -- not from the browser's
   * copy of it. A dish that sold out is still in localStorage and is not on
   * this bill; see the same note on the cart screen.
   */
  const orderableQty = priced.lines.reduce((sum, line) => sum + line.qty, 0);

  return (
    <GuestFlow
      style={paint.style} brandAttrs={paint.attrs}
      step="pay"
      venue={restaurantName}
      table={tableLabel}
      back={{ href: withSlug('/menu/cart'), label: 'Back to your order' }}
      docked={canOrder}
    >
      <header className="px-4 pt-6 pb-4">
        <p className="g-eyebrow">Pay</p>
        <h1 className="g-display mt-1.5">Checkout</h1>
        {/* The count appears once the stored cart has been read. Until then
            it would read "0 items" over an order that is still loading. */}
        <p className="g-lede mt-1.5">
          {!cart.ready ? 'Loading your order…' : orderableQty > 0
            ? `${orderableQty} ${orderableQty === 1 ? 'item' : 'items'} · review your order before sending it.`
            : 'Nothing to order yet — add a dish from the menu first.'}
        </p>
      </header>

      {/* The whole screen is one form, so both Place order buttons -- the one
          in the bill and the one pinned at the bottom -- can read the same
          pending state. Two independent submits would have needed the action
          to be called twice, and would have disagreed about being busy. */}
      <form id="co-place-order" action={submit} onReset={event => event.preventDefault()} className="px-4 pb-8">
        <input type="hidden" name="slug" value={slug ?? ''} />
        <input type="hidden" name="table" value={tableId ?? ''} />
        {notice ? <p role="alert" className="g-card mb-3 bg-accent-soft px-4 py-3 text-[12.5px] text-gink-80">{notice}</p> : null}
        {pendingAttempt ? <p role="status" className="g-card mb-3 px-4 py-3 text-[12.5px] text-gink-80">
          An order attempt is saved on this device. Retry uses its original dishes and note, not any changes made since.
          {pendingAttempt.note ? <> Saved note: {pendingAttempt.note}</> : null}
        </p> : null}

        {/* One column at every width. The bill used to sit in a second column
            on a wide screen and inside the form on a phone; the money is the
            last thing read either way, so it goes last here too. */}
        <div>
          {/*
            ONE method, stated, not two buttons with one of them disabled.

            This used to be a pair of cards -- "Pay at counter" already selected
            and unclickable, next to "Pay online" greyed out. Two dead controls
            in the most important moment of the flow read as a broken page: a
            guest taps the second one and concludes the checkout does not work.
            There is no choice to make here, because an order has to exist
            before it can be paid for, so the screen states the one thing that
            will happen and says plainly what comes next.
          */}
          <h2 className="g-eyebrow mb-2">How you will pay</h2>

          <div data-co-pay="" className="g-panel px-4 py-4">
            <div className="flex items-center gap-3">
              {/* A drawn mark, not a tick: a tick would say "paid", and nothing
                  has been paid on this screen. */}
              <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-[var(--p-accent-soft)] ring-1 ring-[var(--p-accent)]/20">
                <span className="size-2 rounded-full bg-grass" />
              </span>
              <div className="flex flex-col leading-tight">
                <strong className="text-[14.5px] font-semibold text-gink">At the counter</strong>
                <span className="text-[12.5px] text-gink-46">Cash · Card · UPI</span>
              </div>
            </div>

            <p className="mt-3 text-[12.5px] leading-[1.55] text-gink-64">
              Your order is marked payment pending. If your table needs staff confirmation,
              preparation starts after that check. Pay at the counter and ask staff for the final receipt.
            </p>
            <p className="mt-2 text-[12.5px] leading-[1.55] text-gink-46">
              Card and UPI are accepted at the counter. Nothing is charged from your phone.
            </p>
          </div>

          <h2 className="g-eyebrow mt-5 mb-2">Your order</h2>
          <ul className="g-card divide-y divide-hair px-4">
            {priced.lines.map((l) => (
              // Keyed by portion as well as item: two portions of one dish
              // are two rows, and keying only by item made them collide.
              <li
                key={`${l.itemId}|${l.variantId ?? ''}|${(l.addonIds ?? []).join(',')}`}
                className="flex items-center gap-2.5 py-3"
              >
                <DishPhoto src={l.img} name={l.name} size={40} className="size-10" />
                <VegMark veg={l.isVeg} />
                <span className="min-w-0 flex-1 text-[13.5px] leading-[1.45] text-gink">
                  <strong className="tnum font-semibold">{l.qty} ×</strong> {l.name}
                  {l.variantName ? <em className="text-[12.5px] text-gink-46 not-italic"> · {l.variantName}</em> : null}
                  {l.addonNames && l.addonNames.length > 0 ? (
                    <em className="text-[12.5px] text-gink-46 not-italic"> · {l.addonNames.join(', ')}</em>
                  ) : null}
                </span>
                <span className="tnum shrink-0 text-[13.5px] font-semibold text-gink">
                  {formatQuoteMoney(l.lineTotalPaise, taxTreatment)}
                </span>
              </li>
            ))}
            {cart.ready && priced.lines.length === 0 && (
              <li className="py-5 text-center text-[13.5px] text-gink-64">
                Nothing to order yet —{' '}
                <Link href={withSlug('/menu')} className="font-semibold text-[var(--p-accent)] underline underline-offset-2">
                  open the menu
                </Link>
                .
              </li>
            )}
          </ul>

          {/* A dish that sold out while the cart was open is dropped from the
              bill (priceCart does that, and must: an unavailable dish cannot be
              ordered). Dropping it silently left the guest looking at a total
              that had quietly got smaller, with no idea why. */}
          {priced.unavailableIds.length > 0 && (
            <div role="status" className="g-card mt-3 bg-accent-soft px-4 py-3 text-[12.5px] leading-[1.55] text-gink-80">
              {priced.unavailableIds.length === 1
                ? 'One dish is no longer available to order, so it is not in this bill.'
                : `${priced.unavailableIds.length} dishes are no longer available to order, so they are not in this bill.`}{' '}
              <Link href={withSlug('/menu/cart')} className="font-semibold text-[var(--p-accent)] underline underline-offset-2">
                Review your order
              </Link>
            </div>
          )}

          {/* The other way a line can be off this bill: the dish or the
              restaurant's whole menu was withdrawn after it was added. The cart
              screen names it; this screen used to say nothing at all, so a
              guest who reached checkout by a stale link paid for a shorter
              order without ever being told. */}
          {priced.missingIds.length > 0 && (
            <div role="status" className="g-card mt-3 bg-accent-soft px-4 py-3 text-[12.5px] leading-[1.55] text-gink-80">
              {priced.missingIds.length === 1
                ? 'One dish is no longer on the menu, so it is not in this bill.'
                : `${priced.missingIds.length} dishes are no longer on the menu, so they are not in this bill.`}{' '}
              <Link href={withSlug('/menu/cart')} className="font-semibold text-[var(--p-accent)] underline underline-offset-2">
                Review your order
              </Link>
            </div>
          )}

          {(priced.staleVariantIds.length > 0 || priced.staleAddonIds.length > 0) && (
            <div role="status" className="g-card mt-3 bg-accent-soft px-4 py-3 text-[12.5px] leading-[1.55] text-gink-80">
              A portion or add-on you picked changed. Remove the affected line and add it again from the menu.{' '}
              <Link href={withSlug('/menu/cart')} className="font-semibold text-[var(--p-accent)] underline underline-offset-2">Review your order</Link>
            </div>
          )}

          <div className="mt-5">
            <label className="block">
              <span className="g-eyebrow mb-1.5 block">
                Anything the kitchen should know?
              </span>
              <textarea
                name="note"
                disabled={recovery}
                rows={2}
                maxLength={300}
                placeholder="No onion in the raita, less chilli…"
                className="w-full resize-none rounded-[16px] border border-white/70 bg-white/60 px-3.5 py-3 text-[14px] text-gink shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] placeholder:text-gink-28 focus:border-[color-mix(in_oklab,var(--p-accent)_45%,transparent)] focus:bg-white/90 focus:outline-none"
              />
              <span className="mt-1.5 block text-[11.5px] leading-[1.5] text-gink-46">
                For preparation only. Do not include payment or contact details.
              </span>
            </label>
          </div>

          <section className="g-panel mt-5 px-4 py-4">
            <h2 className="g-eyebrow mb-1">Bill</h2>
            <dl className="text-[13.5px]">
              <div className="flex items-baseline justify-between py-1 text-gink-64">
                <dt>{taxTreatment === 'inclusive' ? 'Before GST' : 'Subtotal'}</dt>
                <dd className="tnum">{formatQuoteMoney(subtotalPaise, taxTreatment)}</dd>
              </div>
              <div className="flex items-baseline justify-between py-1 text-gink-64">
                <dt>{quoteTaxLabel(taxTreatment ?? 'exclusive', taxRateBps)}</dt>
                <dd className="tnum">{formatQuoteMoney(taxPaise, taxTreatment)}</dd>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between border-t border-hair pt-2.5 text-[16px] font-semibold text-gink">
                <dt>Total payable</dt>
                <dd className="tnum">{formatQuoteMoney(totalPaise, taxTreatment)}</dd>
              </div>
            </dl>

            <PlaceOrderButton canOrder={canOrder} recovery={recovery} form="co-place-order" variant="bill" />
            <p role="note" className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">
              You pay at the counter. Nothing is collected on this page.
            </p>
          </section>
        </div>

        {/* Inside the form on purpose: useFormStatus only sees a form it is a
            descendant of, and both Place order buttons have to go busy
            together or a second tap writes a second order. */}
        {canOrder && (
          /* The same shelf the menu and cart wear, so the primary action does
             not change shape between two taps of one flow. It is docked rather
             than floating: a bar that hovers 12px above the edge leaves a strip
             of page under the thumb, which is where a thumb lands. */
          <div data-co-bar="" className="fixed inset-x-0 bottom-0 z-40">
            <div data-flow-chrome="shelf" className="w-full">
              <div className="mx-auto flex w-full max-w-[720px] items-center gap-3 px-3 pt-2.5 pb-2">
              <span className="flex flex-col leading-tight">
                <span className="text-[10px] font-semibold tracking-[0.09em] text-gink-46 uppercase">Total payable</span>
                <strong className="tnum text-[17px] font-semibold text-gink">{formatQuoteMoney(totalPaise, taxTreatment)}</strong>
              </span>
                <PlaceOrderButton canOrder={canOrder} recovery={recovery} form="co-place-order" variant="dock" />
              </div>
            </div>
          </div>
        )}
      </form>
    </GuestFlow>
  );
}
