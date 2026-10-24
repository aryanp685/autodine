'use client';

import Link from 'next/link';
import { DishPhoto } from '@/components/DishPhoto';
import { GuestFlow } from '@/components/GuestFlow';
import { GuestTabs } from '@/components/GuestTabs';
import { guestAccentStyle } from '@/lib/branding/palette';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import { priceCart, type MenuItemPrice } from '@/lib/cart-pricing';
import { gstLabel } from '@/lib/pricing';

function Totals({ subtotalPaise, taxPaise, totalPaise, taxRateBps, compact }: {
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** The restaurant's own rate; absent means the bill is priced at a sample. */
  taxRateBps?: number;
  compact?: boolean;
}) {
  return (
    <dl className={compact ? 'text-[13px]' : 'text-[14px]'}>
      <div className="flex items-baseline justify-between py-1.5 text-gink-64">
        <dt>Subtotal</dt>
        <dd className="tnum">{inr(paiseToRupees(subtotalPaise))}</dd>
      </div>
      <div className="flex items-baseline justify-between py-1.5 text-gink-64">
        <dt>Taxes ({gstLabel(taxRateBps)})</dt>
        <dd className="tnum">{inr(paiseToRupees(taxPaise))}</dd>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between border-t border-hair pt-2.5 text-[16px] font-semibold text-gink">
        <dt>Total</dt>
        <dd className="tnum">{inr(paiseToRupees(totalPaise))}</dd>
      </div>
      {/* Only when there is no restaurant rate to price against. This note
          used to render for every guest, including one sitting in a real
          restaurant with a real GST rate, and told them the tax they were
          about to pay was a layout sample. On a demo it is true and worth
          saying; on a live menu it is a lie about someone's bill. */}
      {taxRateBps === undefined && (
        <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
          This menu has no tax rate configured, so the tax above is a sample for layout review rather than a
          rate the restaurant set.
        </p>
      )}
    </dl>
  );
}

/**
 * The cart, priced against the menu the server just read.
 *
 * Names and prices come from `items`, not from the browser: the cart in
 * localStorage holds ids and quantities, so there is no amount there for a
 * customer to change. Anything that has gone missing or sold out since the cart
 * was filled is named rather than quietly dropped -- a dish that vanishes from
 * the bill without a word looks like a mistake.
 */
export function Cart({
  slug,
  restaurantName,
  tableLabel,
  taxRateBps,
  items,
  placedError,
  placedErrorCode,
  needsCode = false,
}: {
  slug?: string;
  restaurantName?: string;
  /** The table a live session confirmed, when there is one. */
  tableLabel?: string | null;
  /** The restaurant's own rate. Without it the bill is priced at a sample. */
  taxRateBps?: number;
  /**
   * The guest scanned a live card but has not entered the on-site code yet.
   * Said here, once, so the code at checkout is expected rather than a
   * surprise at the last tap.
   */
  needsCode?: boolean;
  items: MenuItemPrice[];
  /**
   * Why the last attempt to place this order failed, in the action's own words.
   *
   * The message used to float in a fixed banner over the top of the page, on
   * top of the guest's header, and repeated its own headline: "Could not place
   * that order. / We could not place that order. Please try again." A guest
   * reads that and has no idea whether the cart survived. It sits in the page
   * now, under the heading it belongs to, and says what happened to the cart.
   */
  placedError?: string;
  /**
   * The five-character class of the failure (a SQLSTATE or a PostgREST code).
   *
   * It is not the database's shape and it is not a secret: it says WHICH kind of
   * refusal this was. Without it, an unclassified failure is a sentence a guest
   * can only screenshot, and the next person has no way to tell a busy
   * connection from a missing column.
   */
  placedErrorCode?: string;
}) {
  const cart = useCart();

  const withSlug = (path: string) => (slug ? `${path}?s=${encodeURIComponent(slug)}` : path);
  const priced = priceCart(cart.lines, items, taxRateBps);
  const { subtotalPaise, taxPaise, totalPaise } = priced.totals;

  const dropped = priced.missingIds.length + priced.unavailableIds.length;

  /**
   * How many dishes will actually be ordered.
   *
   * Not `cart.count`: that counts what the browser remembers, and a dish that
   * sold out overnight is still remembered. The header said "3 items" over a
   * bill for one, which is the kind of small disagreement that makes a guest
   * stop trusting the total.
   */
  const orderableQty = priced.lines.reduce((sum, line) => sum + line.qty, 0);

  /* The restaurant, and how much is in the order -- but only once the browser
     has been read. Before that the count is a zero we do not believe, and a
     header reading "Maddi · 0 items" over a cart that is about to appear is
     the same lie as an empty-cart screen. */
  const headerMeta = [
    restaurantName ?? 'Your order',
    cart.ready && orderableQty > 0
      ? `${orderableQty} ${orderableQty === 1 ? 'item' : 'items'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <GuestFlow
      step="cart"
      style={guestAccentStyle()}
      venue={restaurantName}
      table={tableLabel}
      back={{ href: withSlug('/menu'), label: 'Back to the menu' }}
      dock={
        priced.lines.length > 0 ? (
          /* The one action, pinned. It used to exist twice on a phone -- once
             in the bill and once in a fixed bar -- and the bill's was hidden
             below 900px because two black buttons 40px apart is a choice
             nobody asked for. Now there is one, and it is where the thumb is
             at every width. */
          <div data-cart-dock="" className="flex items-center gap-3">
            <span className="flex flex-col leading-tight">
              <span className="text-[10.5px] font-semibold tracking-[0.09em] text-gink-46 uppercase">Total</span>
              <strong className="tnum text-[17px] font-semibold text-gink">{inr(paiseToRupees(totalPaise))}</strong>
            </span>
            <Link
              href={withSlug('/menu/checkout')}
              className="g-primary ml-auto flex items-center gap-2 rounded-full px-5 py-3 text-[13.5px] font-semibold"
            >
              Continue to checkout
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        ) : null
      }
      /* The cart is a place, not a step: the tabs stay, so leaving it is one
         tap rather than the browser's back button. */
      tabs={<GuestTabs slug={slug} active="cart" />}
    >
      <header className="px-4 pt-6 pb-4">
        <p className="g-eyebrow">Your order</p>
        <h1 className="g-display mt-1.5">{headerMeta}</h1>
        <p className="g-lede mt-1.5">
          {priced.lines.length > 0
            ? 'Check the bill, then pay. Prices are read from the kitchen’s menu when you order.'
            : 'Nothing has been added from the menu yet.'}
        </p>
        {needsCode && priced.lines.length > 0 ? (
          <p className="mt-2 flex items-start gap-2 text-[12px] leading-[1.55] text-gink-46">
            <span
              aria-hidden="true"
              className="mt-[6px] size-1.5 shrink-0 rounded-full bg-[var(--p-accent)]"
            />
            <span>
              One step left at checkout: the six-digit code showing inside the restaurant. Your
              order is not sent to the kitchen until it is entered.
            </span>
          </p>
        ) : null}
      </header>

      {placedError ? (
        <div className="px-4 pb-2">
          <div
            role="alert"
            data-place-error=""
            className="g-panel border-[color-mix(in_oklab,var(--alert)_32%,transparent)] px-4 py-3"
          >
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--alert)_14%,white)] text-[12px] font-semibold text-[var(--alert)]"
              >
                !
              </span>
              <div className="min-w-0">
                <strong className="block text-[13px] font-semibold text-gink">
                  That order was not placed
                </strong>
                <p className="mt-0.5 text-[12.5px] leading-[1.55] text-gink-64">{placedError}</p>
                {/* The one thing a guest actually wants to know at this point.
                    Nothing was charged, and the cart is still here -- saying it
                    turns a dead end back into a decision. */}
                <p className="mt-1 text-[11.5px] leading-[1.5] text-gink-46">
                  Nothing has been charged, and your cart is still here.
                </p>
                {placedErrorCode ? (
                  <p className="mt-1 text-[10.5px] leading-[1.45] text-gink-46">
                    Reference {placedErrorCode} — quote this to staff if it happens again.
                  </p>
                ) : null}

              </div>
              <Link
                href={withSlug('/menu/cart')}
                aria-label="Dismiss this message"
                className="ml-auto -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-gink-46 transition hover:bg-gink-07 hover:text-gink"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <div className="px-4 pb-8">
        <div className="flex flex-col gap-2.5">
          {/* The server renders an empty cart because it cannot read
              localStorage. Showing that emptiness for a moment over a cart
              that is not empty reads as the order having been lost. */}
          {!cart.ready ? (
            <div className="g-card px-4 py-8 text-center text-[13.5px] text-gink-46">
              Loading your order…
            </div>
          ) : (
            <>
              {priced.lines.map((l) => (
                // Keyed by portion too. Keying by item alone collapsed a
                // half and a full plate of the same dish onto one React
                // element, so changing one quantity re-rendered the other.
                <div
                  key={`${l.itemId}|${l.variantId ?? ''}|${(l.addonIds ?? []).join(',')}`}
                  className="g-card flex gap-3 p-3"
                >
                  {/* The same photograph the guest tapped on the menu. A
                      bill of names only is hard to check against a table of
                      people deciding who ordered what. */}
                  <DishPhoto src={l.img} name={l.name} size={56} className="size-14" />

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5">
                      <VegMark veg={l.isVeg} />
                      <strong className="truncate text-[14.5px] font-semibold text-gink">{l.name}</strong>
                    </div>

                    <div className="tnum mt-0.5 text-[12.5px] text-gink-46">
                      {l.variantName ? `${l.variantName} · ` : ''}
                      {inr(paiseToRupees(l.unitPricePaise))} each
                    </div>

                    {/* The add-ons the guest picked, named. A line total that
                        is higher than the menu price with no reason on screen
                        reads as a wrong bill. */}
                    {l.addonNames && l.addonNames.length > 0 && (
                      <div className="mt-0.5 text-[12px] leading-[1.45] text-gink-64">
                        + {l.addonNames.join(' · ')}
                        {l.addonPaise ? ` (${inr(paiseToRupees(l.addonPaise))} each)` : ' (free)'}
                      </div>
                    )}

                    {/* Quantity and the line total share a row under the name,
                        because they are the same question: how many, and what
                        does that come to. */}
                    <div className="mt-2 flex items-center gap-3">
                      <div className="g-quiet flex items-center rounded-full">
                        <button
                          type="button"
                          onClick={() => cart.setQty(l.itemId, l.qty - 1, l.variantId, l.addonIds)}
                          aria-label={`Decrease ${l.name}`}
                          className="grid size-7 place-items-center rounded-full text-[14px] text-gink-80 transition hover:bg-gink-07"
                        >
                          −
                        </button>
                        <span className="tnum min-w-5 text-center text-[12.5px] font-semibold text-gink">{l.qty}</span>
                        <button
                          type="button"
                          onClick={() => cart.setQty(l.itemId, l.qty + 1, l.variantId, l.addonIds)}
                          aria-label={`Increase ${l.name}`}
                          className="grid size-7 place-items-center rounded-full text-[14px] text-gink-80 transition hover:bg-gink-07"
                        >
                          +
                        </button>
                      </div>

                      <span className="tnum ml-auto text-[14px] font-semibold text-gink">
                        {inr(paiseToRupees(l.lineTotalPaise))}
                      </span>

                      {/* Visible text stays "Remove"; the accessible name says
                          which dish. Four rows of an identical "Remove" is a
                          list a screen reader cannot navigate. */}
                      <button
                        type="button"
                        onClick={() => cart.remove(l.itemId, l.variantId, l.addonIds)}
                        aria-label={`Remove ${l.name} from your order`}
                        className="rounded-full px-1.5 py-1 text-[11.5px] font-medium text-gink-46 underline decoration-gink-28 underline-offset-2 transition hover:text-[var(--alert)]"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {cart.lines.length === 0 && (
                <div className="g-card px-5 py-9 text-center">
                  <p className="text-[14px] text-gink-64">Your cart is empty — nothing has been added from the menu yet.</p>
                  <Link
                    href={withSlug('/menu')}
                    className="g-primary mt-4 inline-flex rounded-full px-4 py-2.5 text-[13px] font-semibold"
                  >
                    Open the menu
                  </Link>
                </div>
              )}

              {/* Warnings are not errors: nothing is broken and nothing needs
                  undoing, the menu simply moved under a cart that was filled
                  yesterday. So they are a quiet paper card with one action, not
                  a red banner. */}
              {dropped > 0 && (
                <div className="g-card g-soft px-4 py-3">
                  <p className="text-[13px] leading-[1.5] text-gink-80">
                    {dropped === 1 ? 'One dish is' : `${dropped} dishes are`} no longer available, so{' '}
                    {dropped === 1 ? 'it is' : 'they are'} not on the bill.
                  </p>
                  {/* Without this the notice was permanent: the ids stayed in
                      localStorage, so every visit re-read the same dead lines
                      and re-printed the same warning. */}
                  <button
                    type="button"
                    data-cart-notice-action=""
                    onClick={() => cart.removeItems([...priced.missingIds, ...priced.unavailableIds])}
                    className="mt-1.5 text-[12.5px] font-semibold text-[var(--p-accent)] underline underline-offset-2"
                  >
                    Remove {dropped === 1 ? 'it' : 'them'} from my cart
                  </button>
                </div>
              )}

              {/*
                A portion that no longer exists is kept and priced at the menu
                price rather than dropped -- losing the line would lose the
                sale over a menu edit. But the guest has to be told, because
                they chose a cheaper portion and are now being billed the
                dearer one.
              */}
              {/* An add-on the restaurant has since removed is not charged.
                  Saying so is the difference between a bill the guest can
                  check and one they have to take on trust. */}
              {priced.staleAddonIds.length > 0 && (
                <div className="g-card g-soft px-4 py-3 text-[13px] leading-[1.5] text-gink-80">
                  {priced.staleAddonIds.length === 1
                    ? 'One add-on you picked is'
                    : `${priced.staleAddonIds.length} add-ons you picked are`}{' '}
                  no longer on the menu, so {priced.staleAddonIds.length === 1 ? 'it is' : 'they are'}{' '}
                  not on the bill.
                </div>
              )}

              {priced.staleVariantIds.length > 0 && (
                <div className="g-card g-soft px-4 py-3 text-[13px] leading-[1.5] text-gink-80">
                  The portion you picked for{' '}
                  {priced.staleVariantIds.length === 1 ? 'one dish is' : 'some dishes is'} no
                  longer on the menu, so {priced.staleVariantIds.length === 1 ? 'it is' : 'they are'}{' '}
                  priced at the menu price. Please check the bill before paying.
                </div>
              )}
            </>
          )}
        </div>

        {/* The bill, inline. It used to be a second column on a wide screen and
            a card under the lines on a phone, which meant two layouts to keep
            agreeing; one card that reads the same at every width is the version
            a guest can actually check. */}
        {/* A bill of zeroes is not a bill. When every line has dropped out --
            sold out, or off the menu -- the notice above already says why, and
            a card reading Subtotal Rs 0 next to a disabled "Cart is empty"
            button only adds a second, worse explanation. */}
        {priced.lines.length > 0 || !cart.ready ? (
        <section className="g-panel mt-4 px-4 py-4">
          <h2 className="g-eyebrow mb-1">Bill summary</h2>
          <Totals
            subtotalPaise={subtotalPaise}
            taxPaise={taxPaise}
            totalPaise={totalPaise}
            taxRateBps={taxRateBps}
          />
          {priced.lines.length > 0 ? (
            <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
              Prices are read from the kitchen&rsquo;s menu when you order, so the total you are
              charged is the one the restaurant set. Nothing is charged from this phone.
            </p>
          ) : null}
        </section>
        ) : null}
      </div>
    </GuestFlow>
  );
}
