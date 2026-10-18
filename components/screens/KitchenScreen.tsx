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
   Editorial Minimal — locked design system kitchen board
   ========================================================================== */
export function Kitchen() {
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
    <div className="kb">
      <header className="kb__head">
        <div>
          <div className="kb__kicker">Kitchen</div>
          <h1 className="kb__h1">{restaurant.name}</h1>
        </div>
        <div className="kb__controls">
          <div className={`kb__audio ${audio ? 'is-on' : 'is-off'}`}>
            <span className="kb__audioDot" />
            Kitchen audio {audio ? 'on' : 'off'}
            <button className="kb__linkBtn" onClick={() => setAudio(!audio)}>
              {audio ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          <button className="kb__ghost">Test announcement</button>
          <button className="kb__ghost">Replay last</button>
          <div className="kb__live">
            <span className="kb__liveDot" /> Live · 12:46 PM
          </div>
        </div>
      </header>

      <div className="kb__cols">
        {cols.map((c) => (
          <section key={c.key} className="kb__col">
            <div className="kb__colHead">
              <h2>{c.title}</h2>
              <span className="tnum">{c.orders.length}</span>
            </div>
            {c.orders.map((o) => (
              <article key={o.id} className={`kb__ord ${o.state === 'served' ? 'is-served' : ''}`}>
                <div className="kb__ordTop">
                  <div className="kb__ordId">{o.id}</div>
                  <div className="kb__ordTable">{o.table}</div>
                  <div className={`kb__ordAge ${AGE_TONE(o.ageMin)}`}>{o.ageMin} min</div>
                </div>
                {o.payment === 'pending' && (
                  <div className="kb__unpaid">Unpaid · pay at counter</div>
                )}
                <Items order={o} />
                {o.note && <div className="kb__note">“{o.note}”</div>}
                <div className="kb__ordFoot">
                  <Money value={o.total} strong />
                  <div className="kb__actions">
                    {o.state === 'new' && <button className="kb__act">Start preparing</button>}
                    {o.state === 'preparing' && <button className="kb__act">Mark ready</button>}
                    {o.state === 'ready' && <button className="kb__act">Mark served</button>}
                    {o.state === 'served' && <button className="kb__act kb__act--quiet">Done</button>}
                    <button className="kb__act kb__act--quiet" title="Replay voice announcement">
                      🔊
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {c.orders.length === 0 && <div className="kb__empty">Nothing here</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

