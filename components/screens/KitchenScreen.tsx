'use client';

import { useState } from 'react';
import { kitchenOrders, restaurant, inr, type KitchenOrder } from '@/lib/demo-data';
import { Money, VegMark } from '@/components/ui';

const AGE_TONE = (age: number) => (age >= 20 ? 'is-late' : age >= 10 ? 'is-warn' : 'is-fresh');

function Items({ order, compact }: { order: KitchenOrder; compact?: boolean }) {
  return (
    <ul className={compact ? 'kb-items kb-items--compact' : 'kb-items'}>
      {order.items.map((it, i) => (
        <li key={i}>
          <span className="kb-qty">{it.qty}×</span>
          <span className="kb-itemName">
            <VegMark veg={it.veg} size={11} /> {it.name}
            {it.detail && <em> · {it.detail}</em>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================================
   Option A — Editorial Minimal kitchen board
   ========================================================================== */
export function KitchenA() {
  const [audio, setAudio] = useState(true);
  const cols: { key: string; title: string; orders: KitchenOrder[] }[] = [
    { key: 'new', title: 'New', orders: kitchenOrders.filter((o) => o.state === 'new') },
    { key: 'preparing', title: 'Preparing', orders: kitchenOrders.filter((o) => o.state === 'preparing') },
    {
      key: 'ready',
      title: 'Ready / Served',
      orders: kitchenOrders.filter((o) => o.state === 'ready' || o.state === 'served'),
    },
  ];

  return (
    <div className="a-kb">
      <header className="a-kb__head">
        <div>
          <div className="a-kb__kicker">Kitchen</div>
          <h1 className="a-kb__h1">{restaurant.name}</h1>
        </div>
        <div className="a-kb__controls">
          <div className={`a-kb__audio ${audio ? 'is-on' : 'is-off'}`}>
            <span className="a-kb__audioDot" />
            Kitchen audio {audio ? 'on' : 'off'}
            <button className="a-kb__linkBtn" onClick={() => setAudio(!audio)}>
              {audio ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          <button className="a-kb__ghost">Test announcement</button>
          <button className="a-kb__ghost">Replay last</button>
          <div className="a-kb__live">
            <span className="a-kb__liveDot" /> Live · 12:46 PM
          </div>
        </div>
      </header>

      <div className="a-kb__cols">
        {cols.map((c) => (
          <section key={c.key} className="a-kb__col">
            <div className="a-kb__colHead">
              <h2>{c.title}</h2>
              <span className="tnum">{c.orders.length}</span>
            </div>
            {c.orders.map((o) => (
              <article key={o.id} className={`a-kb__ord ${o.state === 'served' ? 'is-served' : ''}`}>
                <div className="a-kb__ordTop">
                  <div className="a-kb__ordId">{o.id}</div>
                  <div className="a-kb__ordTable">{o.table}</div>
                  <div className={`a-kb__ordAge ${AGE_TONE(o.ageMin)}`}>{o.ageMin} min</div>
                </div>
                {o.payment === 'pending' && (
                  <div className="a-kb__unpaid">Unpaid · pay at counter</div>
                )}
                <Items order={o} />
                {o.note && <div className="a-kb__note">“{o.note}”</div>}
                <div className="a-kb__ordFoot">
                  <Money value={o.total} strong />
                  <div className="a-kb__actions">
                    {o.state === 'new' && <button className="a-kb__act">Start preparing</button>}
                    {o.state === 'preparing' && <button className="a-kb__act">Mark ready</button>}
                    {o.state === 'ready' && <button className="a-kb__act">Mark served</button>}
                    {o.state === 'served' && <button className="a-kb__act a-kb__act--quiet">Done</button>}
                    <button className="a-kb__act a-kb__act--quiet" title="Replay voice announcement">
                      🔊
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {c.orders.length === 0 && <div className="a-kb__empty">Nothing here</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
   Option B — Modern Operations kitchen board
   ========================================================================== */
export function KitchenB() {
  const [audio, setAudio] = useState(true);
  const states: { key: KitchenOrder['state']; label: string }[] = [
    { key: 'new', label: 'NEW' },
    { key: 'preparing', label: 'PREPARING' },
    { key: 'ready', label: 'READY' },
    { key: 'served', label: 'SERVED' },
  ];

  return (
    <div className="b-kb">
      <header className="b-kb__top">
        <div className="b-kb__brand">🍳 Kitchen · {restaurant.name}</div>
        <div className="b-kb__counts">
          {states.map((s) => (
            <span key={s.key} className={`b-kb__count b-kb__count--${s.key}`}>
              {s.label} <strong className="tnum">{kitchenOrders.filter((o) => o.state === s.key).length}</strong>
            </span>
          ))}
        </div>
        <div className="b-kb__right">
          <div className={`b-kb__toggle ${audio ? 'is-on' : ''}`} onClick={() => setAudio(!audio)} role="switch" aria-checked={audio}>
            <span className="b-kb__knob" />
            Voice {audio ? 'ON' : 'OFF'}
          </div>
          <button className="b-kb__btn">Test</button>
          <button className="b-kb__btn">Replay last</button>
          <span className="b-kb__conn">
            <span className="b-kb__connDot" /> Connected
          </span>
          <span className="b-kb__clock tnum">12:46</span>
        </div>
      </header>

      <div className="b-kb__grid">
        {states.map((s) => (
          <section key={s.key} className={`b-kb__col b-kb__col--${s.key}`}>
            <div className="b-kb__colHead">
              <span>{s.label}</span>
              <span className="tnum">{kitchenOrders.filter((o) => o.state === s.key).length}</span>
            </div>
            {kitchenOrders
              .filter((o) => o.state === s.key)
              .map((o) => (
                <article key={o.id} className="b-kb__card">
                  <div className="b-kb__cardTop">
                    <div className="b-kb__cardId">
                      <strong>{o.id}</strong>
                      <span className="b-kb__cardTable">{o.table}</span>
                    </div>
                    <div className={`b-kb__age ${AGE_TONE(o.ageMin)}`}>{o.ageMin}m</div>
                  </div>
                  {o.payment === 'pending' && <div className="b-kb__unpaid">⚠ UNPAID · COUNTER</div>}
                  <Items order={o} compact />
                  {o.note && <div className="b-kb__note">Note: {o.note}</div>}
                  <div className="b-kb__cardFoot">
                    <span className="tnum">{inr(o.total)}</span>
                    <div className="b-kb__cardBtns">
                      <button className="b-kb__mini">🔊</button>
                      {s.key === 'new' && <button className="b-kb__primary">Start</button>}
                      {s.key === 'preparing' && <button className="b-kb__primary">Ready</button>}
                      {s.key === 'ready' && <button className="b-kb__primary">Served</button>}
                      {s.key === 'served' && <button className="b-kb__mini">Reopen</button>}
                    </div>
                  </div>
                </article>
              ))}
            {kitchenOrders.filter((o) => o.state === s.key).length === 0 && (
              <div className="b-kb__empty">—</div>
            )}
          </section>
        ))}
      </div>

      <footer className="b-kb__foot">
        <span>Shortcuts: 1 start · 2 ready · 3 served · R replay announcement</span>
        <span>Announcement failures are logged — orders stay on this board.</span>
      </footer>
    </div>
  );
}

/* ============================================================================
   Option C — Warm Hospitality kitchen board
   ========================================================================== */
export function KitchenC() {
  const [audio, setAudio] = useState(true);
  const groups: { title: string; orders: KitchenOrder[] }[] = [
    { title: 'Just in', orders: kitchenOrders.filter((o) => o.state === 'new') },
    { title: 'On the pass', orders: kitchenOrders.filter((o) => o.state === 'preparing') },
    { title: 'Ready to go', orders: kitchenOrders.filter((o) => o.state === 'ready' || o.state === 'served') },
  ];

  return (
    <div className="c-kb">
      <header className="c-kb__head">
        <div>
          <h1>Kitchen</h1>
          <p>{restaurant.name} · 5 open orders</p>
        </div>
        <div className="c-kb__audio">
          <div className="c-kb__audioTop">
            <span className={`c-kb__audioDot ${audio ? 'is-on' : ''}`} />
            <strong>Voice announcements {audio ? 'on' : 'off'}</strong>
          </div>
          <p>Order A-1042 was announced 12 seconds ago</p>
          <div className="c-kb__audioBtns">
            <button onClick={() => setAudio(!audio)}>{audio ? 'Pause' : 'Enable'}</button>
            <button>Test</button>
            <button>Replay</button>
          </div>
        </div>
      </header>

      <div className="c-kb__groups">
        {groups.map((g) => (
          <section key={g.title} className="c-kb__group">
            <div className="c-kb__groupHead">
              <h2>{g.title}</h2>
              <span className="tnum">{g.orders.length}</span>
            </div>
            <div className="c-kb__cards">
              {g.orders.map((o) => (
                <article key={o.id} className={`c-kb__card ${o.state === 'served' ? 'is-served' : ''}`}>
                  <div className="c-kb__cardTop">
                    <div>
                      <strong>{o.id}</strong>
                      <span className="c-kb__table">{o.table}</span>
                    </div>
                    <span className={`c-kb__age ${AGE_TONE(o.ageMin)}`}>{o.ageMin} min</span>
                  </div>
                  {o.payment === 'pending' && <div className="c-kb__unpaid">Payment pending at counter</div>}
                  <Items order={o} />
                  <div className="c-kb__cardFoot">
                    <Money value={o.total} strong />
                    {o.state === 'new' && <button className="c-kb__cta">Start preparing</button>}
                    {o.state === 'preparing' && <button className="c-kb__cta">Mark ready</button>}
                    {o.state === 'ready' && <button className="c-kb__cta">Mark served</button>}
                    {o.state === 'served' && <button className="c-kb__cta c-kb__cta--quiet">Served ✓</button>}
                  </div>
                </article>
              ))}
              {g.orders.length === 0 && <div className="c-kb__empty">All clear</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
