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
   Option A — Editorial Minimal customer menu
   ========================================================================== */
export function CustomerMenuA({ dir }: { dir: string }) {
  const cart = useCart();
  const [cat, setCat] = useState('all');
  const list = byCat(cat);

  return (
    <div className="a-menu">
      <header className="a-menu__head">
        <div className="a-menu__venue">
          <div className="a-menu__venueName">{restaurant.name}</div>
          <div className="a-menu__venueMeta">{restaurant.tagline}</div>
        </div>
        <div className="a-menu__verified">
          <span className="a-menu__verifiedDot" /> Table 7 · on-site verified 12:41 PM
        </div>
      </header>

      <nav className="a-menu__cats">
        <button className={`a-menu__cat ${cat === 'all' ? 'is-active' : ''}`} onClick={() => setCat('all')}>
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`a-menu__cat ${cat === c.id ? 'is-active' : ''}`}
            onClick={() => setCat(c.id)}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <div className="a-menu__list">
        {list.map((i) => (
          <article key={i.id} className={`a-menu__dish ${i.available ? '' : 'is-out'}`}>
            <div className="a-menu__dishBody">
              <div className="a-menu__dishTop">
                <VegMark veg={i.veg} />
                <h3 className="a-menu__dishName">{i.name}</h3>
                {i.badge && <span className="a-menu__dishBadge">{i.badge}</span>}
              </div>
              <p className="a-menu__dishDesc">{i.desc}</p>
              <div className="a-menu__dishPrice">
                {inr(i.price)}
                {i.variants && <span className="a-menu__dishFrom">from</span>}
              </div>
              {i.available ? (
                needsChoice(i) ? (
                  <Link href={`/design/${dir}/item`} className="a-menu__dishCta">
                    Choose options
                  </Link>
                ) : (
                  <button
                    className="a-menu__dishCta"
                    onClick={() => cart.add({ id: i.id, name: i.name, unitPrice: i.price, qty: 1, veg: i.veg })}
                  >
                    Add
                  </button>
                )
              ) : (
                <span className="a-menu__dishOut">Sold out for now</span>
              )}
            </div>
            {i.img && <img className="a-menu__dishImg" src={i.img} alt={i.name} />}
          </article>
        ))}
      </div>

      {cart.count > 0 && (
        <div className="a-menu__cartBar">
          <span>
            {cart.count} item{cart.count === 1 ? '' : 's'} · {inr(cart.subtotal)}
          </span>
          <Link href={`/design/${dir}/cart`} className="a-menu__cartBtn">
            Review order
          </Link>
        </div>
      )}
    </div>
  );
}

/* Option A — item customization: centred sheet, hairlines, no chrome */
export function ItemA({ dir }: { dir: string }) {
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
    <div className="a-menu a-menu--dim">
      <header className="a-menu__head">
        <div className="a-menu__venue">
          <div className="a-menu__venueName">{restaurant.name}</div>
          <div className="a-menu__venueMeta">{restaurant.tagline}</div>
        </div>
        <div className="a-menu__verified">
          <span className="a-menu__verifiedDot" /> Table 7 · on-site verified 12:41 PM
        </div>
      </header>

      <div className="a-menu__list a-menu__list--dim">
        {items.slice(0, 3).map((i) => (
          <article key={i.id} className="a-menu__dish">
            <div className="a-menu__dishBody">
              <div className="a-menu__dishTop">
                <VegMark veg={i.veg} />
                <h3 className="a-menu__dishName">{i.name}</h3>
              </div>
              <p className="a-menu__dishDesc">{i.desc}</p>
              <div className="a-menu__dishPrice">{inr(i.price)}</div>
            </div>
            {i.img && <img className="a-menu__dishImg" src={i.img} alt={i.name} />}
          </article>
        ))}
      </div>

      <div className="a-sheet">
        <div className="a-sheet__panel">
          <div className="a-sheet__head">
            <div>
              <div className="a-sheet__kicker">Customize</div>
              <h2 className="a-sheet__title">{item.name}</h2>
            </div>
            <Link href={`/design/${dir}/customer-menu`} className="a-sheet__close" aria-label="Close">
              ×
            </Link>
          </div>
          <p className="a-sheet__desc">{item.desc}</p>

          <div className="a-sheet__group">
            <div className="a-sheet__label">Portion</div>
            {item.variants!.map((v) => (
              <label key={v.id} className={`a-sheet__opt ${variant === v.id ? 'is-on' : ''}`}>
                <input type="radio" name="variant" checked={variant === v.id} onChange={() => setVariant(v.id)} />
                <span>{v.name}</span>
                <span className="tnum">{inr(v.price)}</span>
              </label>
            ))}
          </div>

          <div className="a-sheet__group">
            <div className="a-sheet__label">Spice level · required</div>
            <div className="a-sheet__chips">
              {item.modifiers![0].options.map((o) => (
                <button
                  key={o.id}
                  className={`a-sheet__chip ${spice === o.id ? 'is-on' : ''}`}
                  onClick={() => setSpice(o.id)}
                >
                  {o.name}
                </button>
              ))}
            </div>
          </div>

          <div className="a-sheet__group">
            <div className="a-sheet__label">Pair it with</div>
            {item.modifiers![1].options.map((o) => (
              <label key={o.id} className={`a-sheet__opt ${bread === o.id ? 'is-on' : ''}`}>
                <input type="radio" name="bread" checked={bread === o.id} onChange={() => setBread(o.id)} />
                <span>{o.name}</span>
                <span className="tnum">{o.price ? `+ ${inr(o.price)}` : '—'}</span>
              </label>
            ))}
          </div>

          <div className="a-sheet__foot">
            <div className="a-sheet__qty">
              <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease">
                −
              </button>
              <span className="tnum">{qty}</span>
              <button onClick={() => setQty(qty + 1)} aria-label="Increase">
                +
              </button>
            </div>
            <button
              className="a-sheet__add"
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
export function CustomerMenuB({ dir }: { dir: string }) {
  const cart = useCart();
  const [cat, setCat] = useState('all');
  const list = byCat(cat);

  return (
    <div className="b-menu">
      <header className="b-menu__top">
        <div className="b-menu__table">T7</div>
        <div className="b-menu__venue">
          <strong>{restaurant.name}</strong>
          <span className="b-menu__meta">{restaurant.tagline}</span>
        </div>
        <div className="b-menu__verify">
          <span className="b-menu__verifyDot" /> Verified on site · 12:41
        </div>
        <div className="b-menu__search">Search dishes…</div>
      </header>

      <div className="b-menu__body">
        <aside className="b-menu__rail">
          <button className={`b-menu__cat ${cat === 'all' ? 'is-active' : ''}`} onClick={() => setCat('all')}>
            All items <span className="tnum">{items.length}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`b-menu__cat ${cat === c.id ? 'is-active' : ''}`}
              onClick={() => setCat(c.id)}
            >
              {c.name} <span className="tnum">{c.count}</span>
            </button>
          ))}
        </aside>

        <div className="b-menu__list">
          {list.map((i) => (
            <article key={i.id} className={`b-menu__dish ${i.available ? '' : 'is-out'}`}>
              {i.img ? <img className="b-menu__thumb" src={i.img} alt={i.name} /> : <div className="b-menu__thumb b-menu__thumb--ph" />}
              <div className="b-menu__dishBody">
                <div className="b-menu__dishTop">
                  <VegMark veg={i.veg} />
                  <strong>{i.name}</strong>
                  {i.badge && <span className="b-menu__flag">{i.badge}</span>}
                </div>
                <p className="b-menu__dishDesc">{i.desc}</p>
                <div className="b-menu__dishFoot">
                  <span className="b-menu__price tnum">{inr(i.price)}</span>
                  {i.variants && <span className="b-menu__from">options</span>}
                </div>
              </div>
              <div className="b-menu__dishAction">
                {i.available ? (
                  needsChoice(i) ? (
                    <Link href={`/design/${dir}/item`} className="b-menu__add">
                      Choose
                    </Link>
                  ) : (
                    <button
                      className="b-menu__add"
                      onClick={() => cart.add({ id: i.id, name: i.name, unitPrice: i.price, qty: 1, veg: i.veg })}
                    >
                      ADD
                    </button>
                  )
                ) : (
                  <span className="b-menu__out">Sold out</span>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="b-menu__cartBar">
        <div>
          <strong>{cart.count}</strong> items · <strong className="tnum">{inr(cart.subtotal)}</strong>
        </div>
        <Link href={`/design/${dir}/cart`} className="b-menu__cartBtn">
          View cart →
        </Link>
      </div>
    </div>
  );
}

/* Option B — item customization: compact right-hand panel */
export function ItemB({ dir }: { dir: string }) {
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
    <div className="b-menu b-menu--dim">
      <header className="b-menu__top">
        <div className="b-menu__table">T7</div>
        <div className="b-menu__venue">
          <strong>{restaurant.name}</strong>
        </div>
        <div className="b-menu__verify">
          <span className="b-menu__verifyDot" /> Verified on site · 12:41
        </div>
      </header>

      <div className="b-menu__body b-menu__body--dim">
        <aside className="b-menu__rail">
          {categories.map((c) => (
            <div key={c.id} className="b-menu__cat">
              {c.name} <span className="tnum">{c.count}</span>
            </div>
          ))}
        </aside>
        <div className="b-menu__list">
          {items.slice(0, 4).map((i) => (
            <article key={i.id} className="b-menu__dish">
              <div className="b-menu__thumb b-menu__thumb--ph" />
              <div className="b-menu__dishBody">
                <div className="b-menu__dishTop">
                  <VegMark veg={i.veg} />
                  <strong>{i.name}</strong>
                </div>
                <p className="b-menu__dishDesc">{i.desc}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <aside className="b-panel">
        <div className="b-panel__head">
          <div>
            <div className="b-panel__kicker">Customize item</div>
            <h3>{item.name}</h3>
          </div>
          <Link href={`/design/${dir}/customer-menu`} className="b-panel__close" aria-label="Close">
            ×
          </Link>
        </div>

        <div className="b-panel__group">
          <div className="b-panel__label">Portion</div>
          {item.variants!.map((v) => (
            <label key={v.id} className={`b-panel__row ${variant === v.id ? 'is-on' : ''}`}>
              <input type="radio" name="v" checked={variant === v.id} onChange={() => setVariant(v.id)} />
              <span>{v.name}</span>
              <span className="tnum">{inr(v.price)}</span>
            </label>
          ))}
        </div>

        <div className="b-panel__group">
          <div className="b-panel__label">Spice level · required</div>
          <div className="b-panel__chips">
            {item.modifiers![0].options.map((o) => (
              <button
                key={o.id}
                className={`b-panel__chip ${spice === o.id ? 'is-on' : ''}`}
                onClick={() => setSpice(o.id)}
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>

        <div className="b-panel__group">
          <div className="b-panel__label">Pair it with</div>
          {item.modifiers![1].options.map((o) => (
            <label key={o.id} className={`b-panel__row ${bread === o.id ? 'is-on' : ''}`}>
              <input type="radio" name="b" checked={bread === o.id} onChange={() => setBread(o.id)} />
              <span>{o.name}</span>
              <span className="tnum">{o.price ? `+${inr(o.price)}` : '—'}</span>
            </label>
          ))}
        </div>

        <div className="b-panel__foot">
          <div className="b-panel__qty">
            <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease">−</button>
            <span className="tnum">{qty}</span>
            <button onClick={() => setQty(qty + 1)} aria-label="Increase">+</button>
          </div>
          <button
            className="b-panel__add"
            onClick={() =>
              cart.add({
                id: item.id,
                name: item.name,
                unitPrice: vPrice + addonPrice,
                qty,
                variant: item.variants!.find((v) => v.id === variant)!.name,
                addons: [spice],
                veg: item.veg,
              })
            }
          >
            Add · {inr(total)}
          </button>
        </div>
      </aside>
    </div>
  );
}

/* ============================================================================
   Option C — Warm Hospitality customer menu
   ========================================================================== */
export function CustomerMenuC({ dir }: { dir: string }) {
  const cart = useCart();
  const [cat, setCat] = useState('all');
  const list = byCat(cat);

  return (
    <div className="c-menu">
      <div className="c-menu__cover">
        <img src="/img/restaurant-interior.jpg" alt="" />
        <div className="c-menu__coverBody">
          <div className="c-menu__chip">
            <span className="c-menu__chipDot" /> Table 7 · verified on site
          </div>
          <h1>{restaurant.name}</h1>
          <p>{restaurant.tagline} · Open till 11 PM</p>
        </div>
      </div>

      <div className="c-menu__pills">
        <button className={`c-menu__pill ${cat === 'all' ? 'is-on' : ''}`} onClick={() => setCat('all')}>
          Everything
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`c-menu__pill ${cat === c.id ? 'is-on' : ''}`}
            onClick={() => setCat(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="c-menu__grid">
        {list.map((i) => (
          <article key={i.id} className={`c-menu__card ${i.available ? '' : 'is-out'}`}>
            <div className="c-menu__cardImg">
              {i.img ? <img src={i.img} alt={i.name} /> : <div className="c-menu__cardPh">{i.name[0]}</div>}
              {i.badge && <span className="c-menu__cardFlag">{i.badge}</span>}
            </div>
            <div className="c-menu__cardBody">
              <div className="c-menu__cardTop">
                <VegMark veg={i.veg} />
                <h3>{i.name}</h3>
              </div>
              <p>{i.desc}</p>
              <div className="c-menu__cardFoot">
                <span className="c-menu__price tnum">{inr(i.price)}</span>
                {i.available ? (
                  needsChoice(i) ? (
                    <Link href={`/design/${dir}/item`} className="c-menu__add">
                      Choose
                    </Link>
                  ) : (
                    <button
                      className="c-menu__add"
                      onClick={() => cart.add({ id: i.id, name: i.name, unitPrice: i.price, qty: 1, veg: i.veg })}
                    >
                      Add
                    </button>
                  )
                ) : (
                  <span className="c-menu__out">Sold out</span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {cart.count > 0 && (
        <div className="c-menu__bar">
          <div className="c-menu__barInfo">
            <strong>{cart.count} items</strong>
            <span className="tnum">{inr(cart.subtotal)}</span>
          </div>
          <Link href={`/design/${dir}/cart`} className="c-menu__barBtn">
            Review order
          </Link>
        </div>
      )}
    </div>
  );
}

/* Option C — item customization: rounded bottom sheet, big tap targets */
export function ItemC({ dir }: { dir: string }) {
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
    <div className="c-menu c-menu--dim">
      <div className="c-menu__cover c-menu__cover--dim">
        <img src="/img/restaurant-interior.jpg" alt="" />
        <div className="c-menu__coverBody">
          <h1>{restaurant.name}</h1>
        </div>
      </div>
      <div className="c-menu__grid c-menu__grid--dim">
        {items.slice(0, 2).map((i) => (
          <article key={i.id} className="c-menu__card">
            <div className="c-menu__cardImg">
              {i.img ? <img src={i.img} alt="" /> : <div className="c-menu__cardPh">{i.name[0]}</div>}
            </div>
            <div className="c-menu__cardBody">
              <div className="c-menu__cardTop">
                <VegMark veg={i.veg} />
                <h3>{i.name}</h3>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="c-sheet">
        <div className="c-sheet__panel">
          <div className="c-sheet__grab" />
          <div className="c-sheet__head">
            <div className="c-sheet__img">
              <img src={item.img} alt="" />
            </div>
            <div>
              <h2>{item.name}</h2>
              <p>{item.desc}</p>
            </div>
            <Link href={`/design/${dir}/customer-menu`} className="c-sheet__close" aria-label="Close">
              ×
            </Link>
          </div>

          <div className="c-sheet__group">
            <div className="c-sheet__label">Portion</div>
            <div className="c-sheet__opts">
              {item.variants!.map((v) => (
                <button
                  key={v.id}
                  className={`c-sheet__opt ${variant === v.id ? 'is-on' : ''}`}
                  onClick={() => setVariant(v.id)}
                >
                  <span>{v.name}</span>
                  <strong className="tnum">{inr(v.price)}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="c-sheet__group">
            <div className="c-sheet__label">Spice level</div>
            <div className="c-sheet__chips">
              {item.modifiers![0].options.map((o) => (
                <button
                  key={o.id}
                  className={`c-sheet__chip ${spice === o.id ? 'is-on' : ''}`}
                  onClick={() => setSpice(o.id)}
                >
                  {o.name}
                </button>
              ))}
            </div>
          </div>

          <div className="c-sheet__group">
            <div className="c-sheet__label">Pair it with</div>
            <div className="c-sheet__opts">
              {item.modifiers![1].options.map((o) => (
                <button
                  key={o.id}
                  className={`c-sheet__opt ${bread === o.id ? 'is-on' : ''}`}
                  onClick={() => setBread(o.id)}
                >
                  <span>{o.name}</span>
                  <strong className="tnum">{o.price ? `+${inr(o.price)}` : 'Free'}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="c-sheet__foot">
            <div className="c-sheet__qty">
              <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease">−</button>
              <span className="tnum">{qty}</span>
              <button onClick={() => setQty(qty + 1)} aria-label="Increase">+</button>
            </div>
            <button
              className="c-sheet__add"
              onClick={() =>
                cart.add({
                  id: item.id,
                  name: item.name,
                  unitPrice: vPrice + addonPrice,
                  qty,
                  variant: item.variants!.find((v) => v.id === variant)!.name,
                  addons: [spice],
                  veg: item.veg,
                })
              }
            >
              Add to order · {inr(total)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
