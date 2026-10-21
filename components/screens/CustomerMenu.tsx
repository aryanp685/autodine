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

const needsChoice = (i: Item) => Boolean(i.variants || i.modifiers);

/**
 * Preset add-on groups, used when an item carries none.
 *
 * The database has no modifier concept yet, so every real dish would
 * otherwise render the customisation sheet with no spice and no bread group.
 * These mirror the demo data exactly, so the locked layout is identical
 * whichever source the data came from.
 */
const PRESET_SPICE: DisplayModifierGroup = {
  id: 'spice',
  name: 'Spice level',
  type: 'single',
  required: true,
  options: [
    { id: 'mild', name: 'Mild', price: 0 },
    { id: 'medium', name: 'Medium', price: 0 },
    { id: 'hot', name: 'Hot', price: 0 },
  ],
};

const PRESET_BREAD: DisplayModifierGroup = {
  id: 'bread',
  name: 'Pair it with',
  type: 'single',
  options: [
    { id: 'none', name: 'No bread', price: 0 },
    { id: 'naan', name: 'Butter naan', price: 79 },
    { id: 'roti', name: 'Tandoori roti', price: 59 },
  ],
};

/**
 * Everything a menu screen shows, already in display units (rupees).
 *
 * Optional on purpose. The locked screens render identically with no data
 * passed -- they fall back to the demo content rather than breaking -- so
 * wiring one screen at a time is safe.
 */
export type MenuScreenData = {
  restaurant: DisplayRestaurant;
  categories: DisplayCategory[];
  items: DisplayItem[];
};

/* ============================================================================
   Editorial Minimal — locked design system customer menu
   ========================================================================== */
export function CustomerMenu({ data }: { data?: MenuScreenData } = {}) {
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
        <div className="menu__verified">
          <span className="menu__verifiedDot" /> Table 7 · on-site verified 12:41 PM
        </div>
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
  const [variant, setVariant] = useState(variants[0]?.id ?? '');
  const [spice, setSpice] = useState('medium');
  const [bread, setBread] = useState('naan');
  const [qty, setQty] = useState(1);
  const cart = useCart();

  const spiceGroup = item.modifiers?.[0] ?? PRESET_SPICE;
  const breadGroup = item.modifiers?.[1] ?? PRESET_BREAD;

  return (
    <div className="menu menu--dim">
      <header className="menu__head">
        <div className="menu__venue">
          <div className="menu__venueName">{restaurant.name}</div>
          <div className="menu__venueMeta">{restaurant.tagline}</div>
        </div>
        <div className="menu__verified">
          <span className="menu__verifiedDot" /> Table 7 · on-site verified 12:41 PM
        </div>
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

          <div className="sheet__group">
            <div className="sheet__label">Spice level · required</div>
            <div className="sheet__chips">
              {spiceGroup.options.map((o) => (
                <button
                  key={o.id}
                  className={`sheet__chip ${spice === o.id ? 'is-on' : ''}`}
                  onClick={() => setSpice(o.id)}
                >
                  {o.name}
                </button>
              ))}
            </div>
          </div>

          <div className="sheet__group">
            <div className="sheet__label">Pair it with</div>
            {breadGroup.options.map((o) => (
              <label key={o.id} className={`sheet__opt ${bread === o.id ? 'is-on' : ''}`}>
                <input type="radio" name="bread" checked={bread === o.id} onChange={() => setBread(o.id)} />
                <span>{o.name}</span>
                <span className="tnum">{o.price ? `+ ${inr(o.price)}` : '—'}</span>
              </label>
            ))}
          </div>

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
                // Only the dish and how many. Portions and add-ons are chosen
                // here but not charged -- the cart carries an id and a
                // quantity, and the price is read from the kitchen's menu when
                // the order is placed, so the options below cannot change what
                // is billed.
                cart.add(item.id, qty);
              }}
            >
              Add to order · {inr(paiseToRupees(item.price * qty))}
            </button>
            {(Boolean(item.variants?.length) || Boolean(item.modifiers?.length)) && (
              <p className="sheet__note">
                Portions and add-ons you pick here are not charged yet — the bill uses
                the menu price of {inr(item.price)} each.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
