'use client';

import Link from 'next/link';
import { useState } from 'react';
import { categories, items, restaurant, type Item } from '@/lib/demo-data';
import { useCart } from '@/components/CartProvider';
import { inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';

const byCat = (id: string) => (id === 'all' ? items : items.filter((i) => i.category === id));
const needsChoice = (i: Item) => Boolean(i.variants || i.modifiers);

/* ============================================================================
   Editorial Minimal — locked design system customer menu
   ========================================================================== */
export function CustomerMenu() {
  const cart = useCart();
  const [cat, setCat] = useState('all');
  const list = byCat(cat);

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
                  <Link href={`/menu/item`} className="menu__dishCta">
                    Choose options
                  </Link>
                ) : (
                  <button
                    className="menu__dishCta"
                    onClick={() => cart.add({ id: i.id, name: i.name, unitPrice: i.price, qty: 1, veg: i.veg })}
                  >
                    Add
                  </button>
                )
              ) : (
                <span className="menu__dishOut">Sold out for now</span>
              )}
            </div>
            {i.img && <img className="menu__dishImg" src={i.img} alt={i.name} />}
          </article>
        ))}
      </div>

      {cart.count > 0 && (
        <div className="menu__cartBar">
          <span>
            {cart.count} item{cart.count === 1 ? '' : 's'} · {inr(cart.subtotal)}
          </span>
          <Link href={`/menu/cart`} className="menu__cartBtn">
            Review order
          </Link>
        </div>
      )}
    </div>
  );
}

/* Option A — item customization: centred sheet, hairlines, no chrome */
export function ItemSheet() {
  const item = items.find((i) => i.id === 'it-butter-chicken')!;
  const [variant, setVariant] = useState(item.variants![0].id);
  const [spice, setSpice] = useState('medium');
  const [bread, setBread] = useState('naan');
  const [qty, setQty] = useState(1);
  const cart = useCart();

  const vPrice = item.variants!.find((v) => v.id === variant)!.price;
  const addonPrice = bread === 'naan' ? 79 : bread === 'roti' ? 59 : 0;
  const total = (vPrice + addonPrice) * qty;

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
        {items.slice(0, 3).map((i) => (
          <article key={i.id} className="menu__dish">
            <div className="menu__dishBody">
              <div className="menu__dishTop">
                <VegMark veg={i.veg} />
                <h3 className="menu__dishName">{i.name}</h3>
              </div>
              <p className="menu__dishDesc">{i.desc}</p>
              <div className="menu__dishPrice">{inr(i.price)}</div>
            </div>
            {i.img && <img className="menu__dishImg" src={i.img} alt={i.name} />}
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
            {item.variants!.map((v) => (
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
              {item.modifiers![0].options.map((o) => (
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
            {item.modifiers![1].options.map((o) => (
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
                cart.add({
                  id: item.id,
                  name: item.name,
                  unitPrice: vPrice + addonPrice,
                  qty,
                  variant: item.variants!.find((v) => v.id === variant)!.name,
                  addons: [spice, bread === 'none' ? '' : `Bread: ${bread}`].filter(Boolean),
                  veg: item.veg,
                });
              }}
            >
              Add to order · {inr(total)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   Option B — Modern Operations customer menu
   ========================================================================== */

/* Option B — item customization: compact right-hand panel */

/* ============================================================================
   Option C — Warm Hospitality customer menu
   ========================================================================== */

/* Option C — item customization: rounded bottom sheet, big tap targets */
