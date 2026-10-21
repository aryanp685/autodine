'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
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

  // Deliberately named to shadow the demo imports, so that not one line of
  // the locked JSX below had to change to accept real data.
  const restaurant = data?.restaurant ?? demoRestaurant;
  const categories = data?.categories ?? demoCategories;
  const items = data?.items ?? demoItems;

  // Priced against this menu for the bar only. It is a running hint, not the
  // amount charged: the order is priced from the database when it is placed.
  const slug = data?.restaurant.slug;
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
  const itemHref = (itemId: string) => {
    const params = new URLSearchParams({ item: itemId });
    if (data?.restaurant.slug) params.set('s', data.restaurant.slug);
    return `/menu/item?${params.toString()}`;
  };

  return (
    <div className="menu">
      <header className="menu__head">
        <div className="menu__venue">
          <div className="menu__venueName">{restaurant.name}</div>
          <div className="menu__venueMeta">{restaurant.tagline}</div>
        </div>
        {table ? (
          <div className="menu__verified">
            <span className="menu__verifiedDot" /> {table.label}
          </div>
        ) : null}
      </header>

      <nav className="menu__cats">
        <button className={`menu__cat ${cat === 'all' ? 'is-active' : ''}`} onClick={() => setCat('all')}>
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`menu__cat ${cat === c.id ? 'is-active' : ''}`}
            onClick={() => setCat(c.id)}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <div className="menu__list">
        {list.map((i) => (
          <article key={i.id} className={`menu__dish ${i.available ? '' : 'is-out'}`}>
            <div className="menu__dishBody">
              <div className="menu__dishTop">
                <VegMark veg={i.veg} />
                <h3 className="menu__dishName">{i.name}</h3>
                {i.badge && <span className="menu__dishBadge">{i.badge}</span>}
              </div>
              <p className="menu__dishDesc">{i.desc}</p>
              <div className="menu__dishPrice">
                {inr(i.price)}
                {i.variants && <span className="menu__dishFrom">from</span>}
              </div>
              {i.available ? (
                needsChoice(i) ? (
                  <Link href={itemHref(i.id)} className="menu__dishCta">
                    Choose options
                  </Link>
                ) : (
                  <button
                    className="menu__dishCta"
                    onClick={() => cart.add(i.id)}
                  >
                    Add
                  </button>
                )
              ) : (
                <span className="menu__dishOut">Sold out for now</span>
              )}
            </div>
            {i.img && <Image className="menu__dishImg" src={i.img} alt={i.name} width={104} height={104} sizes="(max-width: 760px) 76px, 104px" />}
          </article>
        ))}
      </div>

      {cart.count > 0 && (
        <div className="menu__cartBar">
          <span>
            {cart.count} item{cart.count === 1 ? '' : 's'} · {inr(paiseToRupees(barSubtotal))}
          </span>
          <Link href={cartHref} className="menu__cartBtn">
            Review order
          </Link>
        </div>
      )}
    </div>
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
  const item =
    (requestedItemId ? allItems.find((i) => i.id === requestedItemId) : undefined) ??
    // Real menu, no id requested: show the menu's own first customisable dish.
    (data ? allItems.find((i) => i.variants && i.variants.length > 0) ?? allItems[0] : undefined) ??
    demoItems.find((i) => i.id === 'it-butter-chicken')!;

  const variants = item.variants ?? [];
  const groups: DisplayModifierGroup[] = item.modifiers ?? [];

  const [variant, setVariant] = useState(variants[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const cart = useCart();

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

  return (
    <div className="menu menu--dim">
      <header className="menu__head">
        <div className="menu__venue">
          <div className="menu__venueName">{restaurant.name}</div>
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
                <h3 className="menu__dishName">{i.name}</h3>
              </div>
              <p className="menu__dishDesc">{i.desc}</p>
              <div className="menu__dishPrice">{inr(i.price)}</div>
            </div>
            {i.img && <Image className="menu__dishImg" src={i.img} alt={i.name} width={104} height={104} sizes="(max-width: 760px) 76px, 104px" />}
          </article>
        ))}
      </div>

      <div className="sheet">
        <div className="sheet__panel">
          <div className="sheet__head">
            <div>
              <div className="sheet__kicker">Customize</div>
              <h2 className="sheet__title">{item.name}</h2>
            </div>
            <Link href={`/menu`} className="sheet__close" aria-label="Close">
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
              <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease">
                −
              </button>
              <span className="tnum">{qty}</span>
              <button onClick={() => setQty(qty + 1)} aria-label="Increase">
                +
              </button>
            </div>
            <button
              className="sheet__add"
              onClick={() => {
                // The dish, how many, which portion, and which add-ons. All
                // ids: the server prices every one of them from the database,
                // so what is sent can never be what is charged.
                cart.add(item.id, qty, chosenVariant?.id, chosenAddonIds);
              }}
            >
              {/* Both are rupees already: item.price and variant.price come
                  from DisplayItem, which is in display units. Passing them
                  through paiseToRupees divided an already-rupees number by a
                  hundred, so a Rs 250 plate showed as Rs 3. */}
              Add to order · {inr(chosenUnitPrice * qty)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
