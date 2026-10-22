'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  categories as demoCategories,
  items as demoItems,
  restaurant as demoRestaurant,
  type Item,
} from '@/lib/demo-data';
import type {
  DisplayCategory,
  DisplayItem,
  DisplayModifierGroup,
  DisplayRestaurant,
} from '@/lib/db/adapt';
import { DishPhoto } from '@/components/DishPhoto';
import { GuestFlow } from '@/components/GuestFlow';
import { useCart } from '@/components/CartProvider';
import { priceCart } from '@/lib/cart-pricing';
import { inr } from '@/lib/demo-data';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import { VegMark } from '@/components/ui';

/**
 * Whether this dish has anything to choose.
 *
 * Only real choices count. There used to be hard-coded "Spice level" and
 * "Pair it with" groups here for every dish, and neither reached the kitchen
 * or the bill -- the sheet even admitted, underneath, that they were not
 * charged. A dish with nothing to choose now goes straight into the cart
 * instead of opening a sheet full of controls that do nothing.
 */
const needsChoice = (i: Item) =>
  Boolean((i.variants && i.variants.length) || (i.modifiers && i.modifiers.length));

/**
 * Everything a menu screen shows, already in display units (rupees).
 *
 * Optional on purpose. The locked screens render identically with no data
 * passed -- they fall back to the demo content rather than breaking -- so
 * wiring one screen at a time is safe.
 */
/**
 * The table the guest is sitting at, when we actually know it.
 *
 * Optional, and that is the important part. It is only present when a QR was
 * scanned and its session is still live. When it is absent nothing claims the
 * guest is seated -- the badge is simply not rendered.
 *
 * It used to be a hard-coded string reading "Table 7 · on-site verified",
 * shown to everyone. A guest at table 3 was told they were at table 7, and
 * every order reached the kitchen with no table at all. Declining to guess is
 * not a downgrade from that.
 */
export type MenuScreenTable = {
  label: string;
};

export type MenuScreenData = {
  restaurant: DisplayRestaurant;
  /**
   * Every published menu, for the tab bar.
   *
   * Only present when the database was read. The demo menu has one, so the
   * demo screens show no tabs -- exactly as they did before this existed.
   */
  menus?: { id: string; name: string }[];
  /** The menu `categories` and `items` belong to. */
  menuId?: string;
  menuName?: string;
  categories: DisplayCategory[];
  items: DisplayItem[];
  table?: MenuScreenTable | null;
};

/* ============================================================================
   Editorial Minimal — locked design system customer menu
   ========================================================================== */
export function CustomerMenu({ data }: { data?: MenuScreenData } = {}) {
  const table = data?.table ?? null;
  const cart = useCart();
  const [cat, setCat] = useState('all');
  /** Bumped on every add, so the bar re-runs its entry animation. */
  const [barPulse, setBarPulse] = useState(0);

  const addToCart = (itemId: string) => {
    cart.add(itemId);
    setBarPulse((n) => n + 1);
  };

  // Deliberately named to shadow the demo imports, so that not one line of
  // the locked JSX below had to change to accept real data.
  const restaurant = data?.restaurant ?? demoRestaurant;
  const categories = data?.categories ?? demoCategories;
  const items = data?.items ?? demoItems;

  // Priced against this menu for the bar only. It is a running hint, not the
  // amount charged: the order is priced from the database when it is placed.
  const slug = data?.restaurant.slug;
  const menus = data?.menus ?? [];
  const menuId = data?.menuId;
  const menuPrices = items.map((i) => ({
    id: i.id,
    name: i.name,
    pricePaise: rupeesToPaise(i.price),
    isVeg: i.veg,
    isAvailable: i.available,
    // Carried here so the bar counts the extras too. A running total that
    // ignored them would jump by a few hundred rupees at the cart, which
    // reads as a hidden charge rather than as the add-ons the guest picked.
    addons: (i.modifiers ?? []).flatMap((group) =>
      group.options.map((option) => ({
        id: option.id,
        name: option.name,
        pricePaise: rupeesToPaise(option.price),
        groupId: group.id,
        maxSelect: group.max ?? group.options.length,
      })),
    ),
  }));
  const barSubtotal = priceCart(cart.lines, menuPrices).subtotalPaise;
  const cartHref = slug ? `/menu/cart?s=${encodeURIComponent(slug)}` : '/menu/cart';
  const list = cat === 'all' ? items : items.filter((i) => i.category === cat);

  /**
   * How many of this dish are in the cart, for dishes that have nothing to
   * choose. A dish with portions or add-ons is served many ways, so "how many"
   * is a question only the sheet can answer.
   *
   * This is what turns the row's single button into a stepper once something
   * is in the order: adjusting a quantity from the menu is the most common
   * thing a guest does after the first tap, and sending them to the cart to do
   * it is a page load for a minus sign.
   */
  const plainQty = (itemId: string) =>
    cart.lines.find(
      (line) =>
        line.itemId === itemId &&
        !line.variantId &&
        (!line.addonIds || line.addonIds.length === 0),
    )?.qty ?? 0;
  /* How much menu there is, in one line under the venue's name. A guest
     deciding whether to order another round is asking a size question, and
     two true numbers beat an adjective. Both come from the data on screen. */
  const menuMeta = [
    restaurant.tagline?.trim(),
    items.length > 0 ? `${items.length} ${items.length === 1 ? 'dish' : 'dishes'}` : null,
    categories.length > 1 ? `${categories.length} sections` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const itemHref = (itemId: string) => {
    const params = new URLSearchParams({ item: itemId });
    if (data?.restaurant.slug) params.set('s', data.restaurant.slug);
    // Carried through: the sheet loads its dishes from one menu, and this is
    // that menu. Without it the sheet opens on the default menu and cannot
    // find the dish.
    if (menuId) params.set('m', menuId);
    return `/menu/item?${params.toString()}`;
  };

  return (
    <GuestFlow
      step="menu"
      venue={restaurant.name}
      table={table?.label ?? null}
      dock={
        /* The cart is the dock: it is the one action on a menu, and it has to
           stay under the thumb while a guest scrolls past thirty dishes. */
        cart.count > 0 ? (
          <div className="menu__cartBar" key={barPulse}>
            <span className="menu__cartCount" role="status" aria-live="polite">
              <strong className="tnum">{cart.count}</strong> item{cart.count === 1 ? '' : 's'} ·{' '}
              {inr(paiseToRupees(barSubtotal))} before taxes
            </span>
            <Link href={cartHref} className="menu__cartBtn">
              Review order
            </Link>
          </div>
        ) : null
      }
    >
      <header className="menu__head">
        <div className="menu__venue">
          <div className="menu__kicker">The menu</div>
          <h1 className="menu__venueName">{restaurant.name}</h1>
          <div className="menu__venueMeta">{menuMeta}</div>
        </div>
      </header>

      {/*
        Which menu this is. Hidden for the ordinary one-menu restaurant, so
        nothing changes for them; shown the moment there is a second published
        menu, because a guest looking at Breakfast has no other way to reach
        Dinner. Plain links, not buttons: the menu is part of the address, so a
        guest can share or bookmark what they were looking at, and the back
        button does what it says.
      */}
      {menus.length > 1 && (
        <nav className="menu__menus" aria-label="Menus">
          {menus.map((option) => {
            const params = new URLSearchParams({ s: slug ?? '' });
            params.set('m', option.id);
            return (
              <a
                key={option.id}
                href={`/menu?${params.toString()}`}
                className={`menu__menuLink ${option.id === menuId ? 'is-active' : ''}`}
                aria-current={option.id === menuId ? 'page' : undefined}
              >
                {option.name}
              </a>
            );
          })}
        </nav>
      )}

      <nav className="menu__cats" aria-label="Courses">
        <button
          type="button"
          className={`menu__cat ${cat === 'all' ? 'is-active' : ''}`}
          aria-pressed={cat === 'all'}
          onClick={() => setCat('all')}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`menu__cat ${cat === c.id ? 'is-active' : ''}`}
            aria-pressed={cat === c.id}
            onClick={() => setCat(c.id)}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <div className="menu__list">
        {/* What is below, named and counted. The rail above says which course
            is selected; this says it again where the dishes start, so a guest
            who scrolled past the rail still knows what they are reading. The
            count is the filtered list's own length -- never a typed number. */}
        <div className="menu__listHead">
          <span className="menu__listTitle">
            {categories.find((c) => c.id === cat)?.name ?? 'The full menu'}
          </span>
          <span className="menu__listCount tnum">
            {list.length} {list.length === 1 ? 'dish' : 'dishes'}
          </span>
        </div>

        {list.length === 0 && (
          <p className="menu__listEmpty">
            Nothing in this course is available right now. Try another, or ask the counter.
          </p>
        )}

        {list.map((i) => (
          /* One row per dish, in the order a hungry person reads it: what it
             is, what it costs, what is in it -- then the decision, in the
             column the eye already uses for pictures. The price moved above
             the description for that reason; it is the second thing anyone
             looks for and it was three lines down. */
          <article key={i.id} className={`menu__dish ${i.available ? '' : 'is-out'}`}>
            <div className="menu__dishBody">
              <div className="menu__dishTop">
                <VegMark veg={i.veg} />
                <h2 className="menu__dishName">{i.name}</h2>
                {i.badge && i.available && <span className="menu__dishBadge">{i.badge}</span>}
              </div>

              <div className="menu__dishPrice">
                {i.variants && <span className="menu__dishFrom">from</span>}
                {inr(i.price)}
              </div>

              <p className="menu__dishDesc">{i.desc}</p>
            </div>

            {/* The media column is also the action column: on a phone the
                thumb is already there, and a row whose only control lives at
                the far end of a 300px line is a stretch. */}
            <div className={`menu__dishMedia ${i.img ? '' : 'is-bare'}`}>
              {/* Every dish gets a tile. One the kitchen has not photographed
                  yet shows its initials rather than the hole a missing image
                  leaves in an otherwise even column. */}
              <DishPhoto
                src={i.img}
                name={i.name}
                size={116}
                className="menu__dishImg"
                sizes="(max-width: 420px) 76px, (max-width: 760px) 88px, 116px"
              />

              <div className="menu__dishActions">
                {i.available ? (
                  needsChoice(i) ? (
                    <Link href={itemHref(i.id)} className="menu__dishCta">
                      Choose
                    </Link>
                  ) : plainQty(i.id) > 0 ? (
                    <div className="menu__stepper">
                      <button
                        type="button"
                        onClick={() => cart.setQty(i.id, plainQty(i.id) - 1)}
                        aria-label={`One fewer ${i.name}`}
                      >
                        −
                      </button>
                      <span className="tnum" aria-live="polite">
                        {plainQty(i.id)}
                      </span>
                      <button
                        type="button"
                        onClick={() => addToCart(i.id)}
                        aria-label={`One more ${i.name}`}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="menu__dishCta"
                      onClick={() => addToCart(i.id)}
                      aria-label={`Add ${i.name}`}
                    >
                      Add
                    </button>
                  )
                ) : (
                  <span className="menu__dishOut">Sold out</span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

    </GuestFlow>
  );
}

/* Option A — item customization: centred sheet, hairlines, no chrome */
export function ItemSheet({ data, itemId }: { data?: MenuScreenData & { itemId?: string }; itemId?: string } = {}) {
  const table = data?.table ?? null;
  const allItems = data?.items ?? demoItems;
  const restaurant = data?.restaurant ?? demoRestaurant;
  const requestedItemId = data?.itemId ?? itemId;

  // This sheet customises a dish, so it needs one that has portions to choose
  // between.
  //
  // Order matters, and getting it wrong is a visible regression: with no real
  // data the sheet must keep showing Butter Chicken, because that is what the
  // locked design has always shown here. Preferring "first item with variants"
  // unconditionally made it show Paneer Tikka instead.
  //
  // The original also did item.variants![0] unconditionally. That holds for
  // the demo data, where the chosen dish always has portions, but against a
  // real menu it throws the moment the item has none -- which is most of them.
  const requestedItem = requestedItemId
    ? allItems.find((i) => i.id === requestedItemId)
    : undefined;

  /**
   * The dish the link asked for does not exist.
   *
   * This used to fall through to the first dish on the menu, so a stale link
   * -- an old order, a screenshot, a menu edited since -- quietly opened
   * somebody else's dish and let the guest add and pay for it. Saying the dish
   * is gone, with a way back, is the only honest answer.
   */
  const missing = Boolean(requestedItemId) && !requestedItem;

  const item =
    requestedItem ??
    // Real menu, no id requested: show the menu's own first customisable dish.
    (data ? allItems.find((i) => i.variants && i.variants.length > 0) ?? allItems[0] : undefined) ??
    demoItems.find((i) => i.id === 'it-butter-chicken')!;

  const variants = item.variants ?? [];
  const groups: DisplayModifierGroup[] = item.modifiers ?? [];

  const [variant, setVariant] = useState(variants[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const cart = useCart();
  const router = useRouter();

  /**
   * The timer that takes the guest back to the menu after adding.
   *
   * Held in a ref so it can be cancelled: a guest who taps Back or closes the
   * sheet inside those 700ms was being pushed to the menu anyway, from a page
   * they had already left.
   */
  const returnTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (returnTimer.current !== null) window.clearTimeout(returnTimer.current);
  }, []);

  /**
   * Where closing the sheet goes.
   *
   * This used to be a bare "/menu", which threw away the restaurant and the
   * menu it came from -- against a configured database a bare /menu is not
   * the menu at all, it is "Open this menu from your table". So customising a
   * dish and then closing the sheet was a dead end, in production only.
   */
  const backHref = (() => {
    const params = new URLSearchParams();
    if (data?.restaurant.slug) params.set('s', data.restaurant.slug);
    if (data?.menuId) params.set('m', data.menuId);
    const query = params.toString();
    return query ? `/menu?${query}` : '/menu';
  })();

  /* The sheet is the last thing on the page, so Escape has to work or a
     keyboard user is stuck on a dish they did not mean to open. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') router.push(backHref);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, backHref]);

  /**
   * What has been picked in each add-on group, by option id.
   *
   * A required single-choice group starts with its first option already
   * picked. That is the honest reading of "required": a guest who does not
   * care still ends up with a valid answer, instead of a disabled button and
   * no explanation.
   */
  const [picks, setPicks] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const group of groups) {
      initial[group.id] =
        group.required && group.type === 'single' && group.options[0]
          ? [group.options[0].id]
          : [];
    }
    return initial;
  });

  const toggle = (group: DisplayModifierGroup, optionId: string) => {
    setPicks((current) => {
      const chosen = current[group.id] ?? [];

      if (group.type === 'single') return { ...current, [group.id]: [optionId] };

      if (chosen.includes(optionId)) {
        return { ...current, [group.id]: chosen.filter((id) => id !== optionId) };
      }

      // The owner's limit, applied at the moment of the click rather than on
      // the bill. Beyond it nothing happens, and the chips that would exceed
      // it are disabled, so the rule is visible before it is hit.
      const max = group.max ?? group.options.length;
      if (chosen.length >= max) return current;

      return { ...current, [group.id]: [...chosen, optionId] };
    });
  };

  const chosenAddonIds = groups.flatMap((group) => picks[group.id] ?? []);

  /**
   * What the add-ons add to ONE plate.
   *
   * Priced here from the menu's own numbers so the button and the bill agree
   * before the guest commits. The amount actually charged is still read from
   * the database when the order is written -- this is a preview, and the ids
   * are all that leave the browser.
   */
  const addonRupees = groups.reduce(
    (sum, group) =>
      sum +
      (picks[group.id] ?? []).reduce(
        (inner, id) => inner + (group.options.find((o) => o.id === id)?.price ?? 0),
        0,
      ),
    0,
  );

  /**
   * The portion being bought, and what the plate costs with its add-ons.
   *
   * A dish with no portions has no variant and is priced at its menu price.
   * A dish with portions is priced at the selected one -- which is the whole
   * point of asking. The button and the bill have to agree.
   */
  const chosenVariant = variants.find((v) => v.id === variant);
  const chosenUnitPrice = (chosenVariant?.price ?? item.price) + addonRupees;

  /**
   * How many more of this exact line the cart can hold.
   *
   * The sheet used to increment without a ceiling while the cart silently
   * stopped at 99, so the button could promise "Add to order · ₹12,400" for a
   * hundred plates and the cart would hold ninety-nine. The limit is shared
   * with lib/cart-storage.ts, and the button now says what will actually be
   * added.
   */
  const existingQty =
    cart.lines.find(
      (line) =>
        line.itemId === item.id &&
        (line.variantId ?? '') === (variant ?? '') &&
        [...(line.addonIds ?? [])].sort().join(',') === [...chosenAddonIds].sort().join(','),
    )?.qty ?? 0;
  const room = Math.max(0, 99 - existingQty);
  const addQty = Math.min(qty, room);
  const atCeiling = room === 0;

  if (missing) {
    return (
      <div className="cart cart--plain">
        <header className="cart__head">
          <h1>That dish is not on the menu</h1>
          <p>
            The link may be from an older menu, or the restaurant has taken the dish off today.
            Nothing has been added to your order.
          </p>
        </header>
        <div className="cart__grid">
          <div className="cart__empty">
            <Link href={backHref}>Back to the menu</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="menu menu--dim">
      <Link href={backHref} className="sheet__scrim" aria-label="Close" tabIndex={-1} />
      <header className="menu__head">
        <div className="menu__venue">
          <div className="menu__kicker">The menu</div>
          <h1 className="menu__venueName">{restaurant.name}</h1>
          <div className="menu__venueMeta">{restaurant.tagline}</div>
        </div>
        {table ? (
          <div className="menu__verified">
            <span className="menu__verifiedDot" /> {table.label}
          </div>
        ) : null}
      </header>

      <div className="menu__list menu__list--dim">
        {allItems.slice(0, 3).map((i) => (
          <article key={i.id} className="menu__dish">
            <div className="menu__dishBody">
              <div className="menu__dishTop">
                <VegMark veg={i.veg} />
                <h2 className="menu__dishName">{i.name}</h2>
              </div>
              <p className="menu__dishDesc">{i.desc}</p>
              <div className="menu__dishPrice">{inr(i.price)}</div>
            </div>
            <DishPhoto src={i.img} name={i.name} size={104} className="menu__dishImg" />
          </article>
        ))}
      </div>

      <div className="sheet">
        <div className="sheet__panel">
          <div className="sheet__head">
            <div>
              {/* "Customize" over a dish with no portions and no add-ons is a
                  heading for a decision that does not exist. */}
              <div className="sheet__kicker">
                {variants.length > 0 || groups.length > 0 ? 'Customize' : 'Add to order'}
              </div>
              <h2 className="sheet__title">{item.name}</h2>
            </div>
            <Link href={backHref} className="sheet__close" aria-label="Close">
              ×
            </Link>
          </div>
          <p className="sheet__desc">{item.desc}</p>

          {variants.length > 0 && (
            <div className="sheet__group">
              <div className="sheet__label">Portion</div>
              {variants.map((v) => (
                <label key={v.id} className={`sheet__opt ${variant === v.id ? 'is-on' : ''}`}>
                  <input type="radio" name="variant" checked={variant === v.id} onChange={() => setVariant(v.id)} />
                  <span>{v.name}</span>
                  <span className="tnum">{inr(v.price)}</span>
                </label>
              ))}
            </div>
          )}

          {/* The dish's own add-ons, defined by the restaurant. Every price
              shown here is one the till will charge: place_public_order reads
              item_addons for the amount. */}
          {groups.map((group) => {
            const chosen = picks[group.id] ?? [];
            const max = group.max ?? group.options.length;
            const atMax = group.type === 'multi' && chosen.length >= max;

            return (
              <div key={group.id} className="sheet__group">
                <div className="sheet__label">
                  {group.name}
                  {group.required ? ' · required' : ''}
                  {group.type === 'multi' ? ` · pick up to ${max}` : ''}
                </div>

                {group.type === 'single' ? (
                  <div>
                    {group.options.map((option) => (
                      <label
                        key={option.id}
                        className={`sheet__opt ${chosen.includes(option.id) ? 'is-on' : ''}`}
                      >
                        <input
                          type="radio"
                          name={`addon-${group.id}`}
                          checked={chosen.includes(option.id)}
                          onChange={() => toggle(group, option.id)}
                        />
                        <span>{option.name}</span>
                        <span className="tnum">{option.price ? `+ ${inr(option.price)}` : '—'}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="sheet__chips">
                    {group.options.map((option) => {
                      const on = chosen.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`sheet__chip ${on ? 'is-on' : ''}`}
                          aria-pressed={on}
                          disabled={!on && atMax}
                          onClick={() => toggle(group, option.id)}
                        >
                          {option.name}
                          {option.price ? ` + ${inr(option.price)}` : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="sheet__foot">
            <div className="sheet__qty">
              <button
                type="button"
                onClick={() => setQty(Math.max(1, qty - 1))}
                aria-label="Decrease"
                disabled={qty <= 1 || atCeiling}
              >
                −
              </button>
              <span className="tnum">{Math.max(1, addQty)}</span>
              <button
                type="button"
                onClick={() => setQty(Math.min(room, qty + 1))}
                aria-label="Increase"
                disabled={qty >= room || atCeiling}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className={`sheet__add ${added ? 'is-added' : ''}`}
              aria-live="polite"
              disabled={atCeiling}
              onClick={() => {
                // The dish, how many, which portion, and which add-ons. All
                // ids: the server prices every one of them from the database,
                // so what is sent can never be what is charged.
                cart.add(item.id, addQty, chosenVariant?.id, chosenAddonIds);

                // Confirm, then leave. Adding used to change a number on a bar
                // behind an overlay and nothing else, so the obvious next move
                // was to hunt for the close button -- which was broken. The
                // button says what happened for a moment, then the guest is
                // back on the menu, where the next dish is.
                setAdded(true);
                returnTimer.current = window.setTimeout(() => router.push(backHref), 700);
              }}
            >
              {added ? (
                'Added to your order ✓'
              ) : atCeiling ? (
                '99 is the most of one dish we take online'
              ) : (
                <>
                  {/* Both are rupees already: item.price and variant.price
                      come from DisplayItem, which is in display units.
                      Passing them through paiseToRupees divided an
                      already-rupees number by a hundred, so a Rs 250 plate
                      showed as Rs 3. */}
                  Add to order · {inr(chosenUnitPrice * Math.max(1, addQty))}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
