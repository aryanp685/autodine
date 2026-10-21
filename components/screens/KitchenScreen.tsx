'use client';

import { useState } from 'react';
import { kitchenOrders, restaurant, type KitchenOrder } from '@/lib/demo-data';
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

export function Kitchen() {
  const [audio, setAudio] = useState(false);
  const [orders, setOrders] = useState<KitchenOrder[]>(() => kitchenOrders.map((order) => ({ ...order })));
  const [announcement, setAnnouncement] = useState('');

  const speak = (text: string) => {
    setAnnouncement(text);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && audio) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  };

  const advance = (id: string) => {
    const nextState: Record<KitchenOrder['state'], KitchenOrder['state']> = {
      new: 'preparing', preparing: 'ready', ready: 'served', served: 'served',
    };
    const current = orders.find((order) => order.id === id);
    if (!current || current.state === 'served') return;
    const state = nextState[current.state];
    speak(`Order ${current.id} for table ${current.table}, ${state}`);
    setOrders((list) => list.map((order) => order.id === id ? { ...order, state } : order));
  };

  const cols: { key: string; title: string; orders: KitchenOrder[] }[] = [
    { key: 'new', title: 'New', orders: orders.filter((o) => o.state === 'new') },
    { key: 'preparing', title: 'Preparing', orders: orders.filter((o) => o.state === 'preparing') },
    {
      key: 'ready', title: 'Ready / Served',
      orders: orders.filter((o) => o.state === 'ready' || o.state === 'served'),
    },
  ];

  return (
    <div className="kb">
      <header className="kb__head">
        <div>
          <div className="kb__kicker">Kitchen · demo mode</div>
          <h1 className="kb__h1">{restaurant.name}</h1>
        </div>
        <div className="kb__controls">
          <div className={`kb__audio ${audio ? 'is-on' : 'is-off'}`}>
            <span className="kb__audioDot" />
            Kitchen audio {audio ? 'on' : 'off'}
            <button type="button" className="kb__linkBtn" onClick={() => setAudio((value) => !value)}>
              {audio ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          <button type="button" className="kb__ghost" onClick={() => speak('AutoDine kitchen audio test')}>Test announcement</button>
          <button type="button" className="kb__ghost" onClick={() => {
            const latest = orders.find((order) => order.state !== 'served') ?? orders[0];
            if (latest) speak(`Order ${latest.id} for table ${latest.table}`);
          }}>Replay latest</button>
          <div className="kb__live"><span className="kb__liveDot" /> Demo board · local only</div>
          {announcement && <span className="ui-hint" role="status">Last announcement: {announcement}</span>}
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
                    {o.state === 'new' && <button type="button" className="kb__act" onClick={() => advance(o.id)}>Start preparing</button>}
                    {o.state === 'preparing' && <button type="button" className="kb__act" onClick={() => advance(o.id)}>Mark ready</button>}
                    {o.state === 'ready' && <button type="button" className="kb__act" onClick={() => advance(o.id)}>Mark served</button>}
                    {o.state === 'served' && <span className="kb__act kb__act--quiet" aria-label="Order served">Served</span>}
                    <button type="button" className="kb__act kb__act--quiet" title="Replay voice announcement" aria-label={`Replay order ${o.id}`} onClick={() => speak(`Order ${o.id} for table ${o.table}`)}>
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

