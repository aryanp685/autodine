'use client';

import Link from 'next/link';
import { DishPhoto } from '@/components/DishPhoto';
import { GuestFlow } from '@/components/GuestFlow';
import { guestAccentStyle } from '@/lib/branding/palette';
import { PlaceOrderButton } from '@/components/PlaceOrderButton';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import { priceCart, type MenuItemPrice } from '@/lib/cart-pricing';
import { placeOrderAction } from '@/app/menu/checkout/actions';
import { gstLabel } from '@/lib/pricing';

/**
 * Checkout.
 *
 * One path, and it is the same order either way: the order goes to the kitchen
 * immediately, marked payment pending. What differs is what happens next, and
 * the screen says which.
 *
 *   counter  the guest pays the cashier, who records it at the till.
 *   online   the guest pays by card/UPI on their own order page, straight
 *            after placing, and the order is marked paid only when the
 *            gateway confirms it.
 *
 * No payment choice is made HERE, because none can be: the order has to exist
 * before it can be paid. Drawing "Pay online" as a selectable option would
 * promise a card sheet this screen cannot open.
 */
export function Checkout({
  slug,
  restaurantName,
  tableLabel,
  taxRateBps,
  items,
  onlinePaymentAvailable = false,
}: {
  slug?: string;
  restaurantName?: string;
  /** The table a live session confirmed, when there is one. */
  tableLabel?: string | null;
  /** The restaurant's own rate. Without it the bill is priced at a sample. */
  taxRateBps?: number;
  items: MenuItemPrice[];
  /**
   * Owner switch AND a gateway this deployment can verify with. False means
   * the guest is told the counter is how payment happens -- including when an
   * owner has switched it on but the server has no keys.
   */
  onlinePaymentAvailable?: boolean;
}) {
  const cart = useCart();
  const priced = priceCart(cart.lines, items, taxRateBps);
  const { subtotalPaise, taxPaise, totalPaise } = priced.totals;

  const withSlug = (path: string) => (slug ? `${path}?s=${encodeURIComponent(slug)}` : path);
  const canOrder = cart.ready && priced.lines.length > 0;
  /**
   * The count in the header, from the priced cart -- not from the browser's
   * copy of it. A dish that sold out is still in localStorage and is not on
   * this bill; see the same note on the cart screen.
   */
  const orderableQty = priced.lines.reduce((sum, line) => sum + line.qty, 0);

  return (
    <GuestFlow
      style={guestAccentStyle()}
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
          {cart.ready && orderableQty > 0
            ? `${orderableQty} ${orderableQty === 1 ? 'item' : 'items'} · the kitchen starts as soon as you place it.`
            : 'Nothing to order yet — add a dish from the menu first.'}
        </p>
      </header>

      {/* The whole screen is one form, so both Place order buttons -- the one
          in the bill and the one pinned at the bottom -- can read the same
          pending state. Two independent submits would have needed the action
          to be called twice, and would have disagreed about being busy. */}
      <form id="co-place-order" action={placeOrderAction} className="px-4 pb-8">
        <input type="hidden" name="slug" value={slug ?? ''} />
        {/* Only ids and quantities go to the server. The prices are read from
            the database when the order is written. */}
        <input type="hidden" name="lines" value={JSON.stringify(cart.lines)} />

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
                <span className="size-2 rounded-full bg-[var(--p-accent)]" />
              </span>
              <div className="flex flex-col leading-tight">
                <strong className="text-[14.5px] font-semibold text-gink">At the counter</strong>
                <span className="text-[12.5px] text-gink-46">Cash · Card · UPI</span>
              </div>
            </div>

            <p className="mt-3 text-[12.5px] leading-[1.55] text-gink-64">
              Your order goes to the kitchen straight away and is marked payment pending. Pay the
              cashier before you leave; the receipt is issued once the payment is recorded.
            </p>
            <p className="mt-2 text-[12.5px] leading-[1.55] text-gink-46">
              {onlinePaymentAvailable
                ? 'This restaurant also takes card or UPI online, on the order page you reach after placing — the order is marked paid only when the gateway confirms it.'
                : 'Card and UPI are accepted at the counter. Nothing is charged from your phone.'}
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
                  {inr(paiseToRupees(l.lineTotalPaise))}
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
                ? 'One dish has sold out since you added it, so it is not in this bill.'
                : `${priced.unavailableIds.length} dishes have sold out since you added them, so they are not in this bill.`}{' '}
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

          {priced.staleVariantIds.length > 0 && (
            <div role="status" className="g-card mt-3 bg-accent-soft px-4 py-3 text-[12.5px] leading-[1.55] text-gink-80">
              A portion you picked is no longer on the menu, so that dish is priced at the
              menu price. Check the bill before you place it.
            </div>
          )}

          <div className="mt-5">
            <label className="block">
              <span className="g-eyebrow mb-1.5 block">
                Anything the kitchen should know?
              </span>
              <textarea
                name="note"
                rows={2}
                maxLength={300}
                placeholder="No onion in the raita, less chilli…"
                className="w-full resize-none rounded-[16px] border border-white/70 bg-white/60 px-3.5 py-3 text-[14px] text-gink shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] placeholder:text-gink-28 focus:border-[color-mix(in_oklab,var(--p-accent)_45%,transparent)] focus:bg-white/90 focus:outline-none"
              />
              <span className="mt-1.5 block text-[11.5px] leading-[1.5] text-gink-46">
                A note is read by the kitchen, not a special instruction the bill is priced
                against.
              </span>
            </label>
          </div>

          <section className="g-panel mt-5 px-4 py-4">
            <h2 className="g-eyebrow mb-1">Bill</h2>
            <dl className="text-[13.5px]">
              <div className="flex items-baseline justify-between py-1 text-gink-64">
                <dt>Subtotal</dt>
                <dd className="tnum">{inr(paiseToRupees(subtotalPaise))}</dd>
              </div>
              <div className="flex items-baseline justify-between py-1 text-gink-64">
                <dt>Taxes ({gstLabel(taxRateBps)})</dt>
                <dd className="tnum">{inr(paiseToRupees(taxPaise))}</dd>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between border-t border-hair pt-2.5 text-[16px] font-semibold text-gink">
                <dt>Total payable</dt>
                <dd className="tnum">{inr(paiseToRupees(totalPaise))}</dd>
              </div>
            </dl>

            <PlaceOrderButton totalPaise={totalPaise} canOrder={canOrder} form="co-place-order" variant="bill" />
            <p role="note" className="mt-2.5 text-[11.5px] leading-[1.5] text-gink-46">
              {onlinePaymentAvailable
                ? 'Pay at the counter, or by card/UPI on the next screen. The kitchen starts straight away either way.'
                : 'You pay at the counter. The kitchen starts on this straight away.'}
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
                <strong className="tnum text-[17px] font-semibold text-gink">{inr(paiseToRupees(totalPaise))}</strong>
              </span>
                <PlaceOrderButton totalPaise={totalPaise} canOrder={canOrder} form="co-place-order" variant="dock" />
              </div>
            </div>
          </div>
        )}
      </form>
    </GuestFlow>
  );
}
