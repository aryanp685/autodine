'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { kitchenOrders, restaurant, type KitchenOrder } from '@/lib/demo-data';
import { Money, VegMark } from '@/components/ui';
import type { KitchenScreenData, KitchenTicket } from '@/lib/db/kitchen-screen';
import { nextPrepState, type PrepState } from '@/lib/db/prep';
import { advanceOrderAction } from '@/app/kitchen/actions';
import { SignInPrompt } from '@/components/SignInPrompt';

const AGE_TONE = (age: number) => (age >= 20 ? 'is-late' : age >= 10 ? 'is-warn' : 'is-fresh');

/**
 * One ticket on the board, in the shape the locked markup renders.
 *
 * `orderId` is the database UUID and is ABSENT on demo rows. Every control
 * that mutates renders only when it is present, so a fictional ticket can
 * never be submitted as if it were a real one.
 */
type BoardTicket = {
  key: string;
  orderId?: string;
  code: string;
  table: string;
  placedAt: string;
  ageMin: number;
  payment: 'paid' | 'pending' | 'failed';
  state: KitchenOrder['state'];
  note?: string;
  items: { qty: number; name: string; detail?: string; veg: boolean }[];
  total: number;
};

function fromDemo(order: KitchenOrder): BoardTicket {
  return {
    key: order.id,
    code: order.id,
    table: order.table,
    placedAt: order.placedAt,
    ageMin: order.ageMin,
    payment: order.payment,
    state: order.state,
    note: order.note,
    items: order.items,
    total: order.total,
  };
}

function fromLive(ticket: KitchenTicket): BoardTicket {
  return {
    key: ticket.id ?? ticket.code,
    orderId: ticket.id,
    code: ticket.code,
    table: ticket.table,
    placedAt: ticket.placedAt,
    ageMin: ticket.ageMin,
    payment: ticket.payment,
    state: ticket.state,
    note: ticket.note,
    items: ticket.items,
    total: ticket.total,
  };
}

function Items({ order, compact }: { order: BoardTicket; compact?: boolean }) {
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

   Two sources of truth are deliberately avoided. The database is the only
   one; local state holds nothing but a map of in-flight optimistic moves,
   keyed by order UUID. When an action succeeds the entry is dropped and the
   server's own value is what renders. When it fails the entry is dropped too,
   which rolls the tile back to whatever the server last said. There is no
   third state where the board disagrees with the database and stays there.

   In demo mode there is no server to agree with, so the override persists
   and the board behaves exactly as it always did.
   ========================================================================== */
export function Kitchen({ data }: { data?: KitchenScreenData | null }) {
  const [audio, setAudio] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Record<string, PrepState>>({});

  const live = Boolean(data);

  // Only a live board polls. A demo board has nothing to poll.
  useAutoRefresh(live);

  const base: BoardTicket[] = live
    ? (data?.tickets ?? []).map(fromLive)
    : kitchenOrders.map(fromDemo);

  // Optimistic overlay. Applied on top of `base`, so a refresh from the
  // server simply wins without any resync bookkeeping.
  const orders = base.map((ticket) =>
    ticket.orderId && pending[ticket.orderId]
      ? { ...ticket, state: pending[ticket.orderId]! }
      : ticket
  );

  const speak = useCallback(
    (text: string) => {
      setAnnouncement(text);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && audio) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
    },
    [audio]
  );

  const advance = async (ticket: BoardTicket) => {
    // Demo rows have no database identity. Nothing to call, so nothing
    // pretends to have been saved.
    if (!ticket.orderId) {
      setError('This board is showing sample data. Connect the database to cook real tickets.');
      return;
    }

    // Same shared machine the server uses, so the optimistic move and the
    // write can never disagree.
    const next = nextPrepState(ticket.state);
    if (!next) return;

    speak(`Order ${ticket.code} for table ${ticket.table}, ${next}`);
    setError('');
    setPending((current) => ({ ...current, [ticket.orderId!]: next }));

    const result = await advanceOrderAction(ticket.orderId);

    // Drop the override either way: on success the server now holds this
    // state, on failure the tile must snap back to it.
    setPending((current) => {
      const copy = { ...current };
      delete copy[ticket.orderId!];
      return copy;
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.state) {
      // The server is authoritative about what it moved to, which may differ
      // from our guess if another device advanced the ticket first.
      setPending((current) => ({ ...current, [ticket.orderId!]: result.state! }));
      setTimeout(() => {
        setPending((current) => {
          const copy = { ...current };
          delete copy[ticket.orderId!];
          return copy;
        });
      }, 0);
    }
  };

  const cols: { key: string; title: string; orders: BoardTicket[] }[] = [
    { key: 'new', title: 'New', orders: orders.filter((o) => o.state === 'new') },
    { key: 'preparing', title: 'Preparing', orders: orders.filter((o) => o.state === 'preparing') },
    {
      key: 'ready',
      title: 'Ready / Served',
      orders: orders.filter((o) => o.state === 'ready' || o.state === 'served'),
    },
  ];

  return (
    <div className="kb">
      <header className="kb__head">
        <div>
          <div className="kb__kicker">Kitchen · {live ? 'live board' : 'demo mode'}</div>
          <h1 className="kb__h1">{live ? data?.restaurantName : restaurant.name}</h1>
        </div>
        <div className="kb__controls">
          <div className={`kb__audio ${audio ? 'is-on' : 'is-off'}`}>
            <span className="kb__audioDot" />
            Kitchen audio {audio ? 'on' : 'off'}
            <button type="button" className="kb__linkBtn" onClick={() => setAudio((value) => !value)}>
              {audio ? 'Turn off' : 'Turn on'}
            </button>
          </div>
          <button type="button" className="kb__ghost" onClick={() => speak('AutoDine kitchen audio test')}>
            Test announcement
          </button>
          <button
            type="button"
            className="kb__ghost"
            onClick={() => {
              const latest = orders.find((order) => order.state !== 'served') ?? orders[0];
              if (latest) speak(`Order ${latest.code} for table ${latest.table}`);
            }}
          >
            Replay latest
          </button>
          <div className="kb__live">
            <span className="kb__liveDot" />
            {live ? 'Live · refreshes automatically' : 'Demo board · local only'}
          </div>
          {announcement && (
            <span className="ui-hint" role="status">
              Last announcement: {announcement}
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="pg__alert" role="alert" style={{ margin: '0 0 16px' }}>
          <strong>Could not update the ticket.</strong>
          <p>{error}</p>
        </div>
      )}

      {data?.blocked && <SignInPrompt reason={data.blocked} screen="kitchen board" />}

      {live && data && !data.blocked && data.tickets.length === 0 && (
        <div className="kb__empty" style={{ marginBottom: 16 }}>
          No open tickets in the last few hours. Orders placed from the customer menu appear here
          as soon as they are paid for or sent to the kitchen.
        </div>
      )}

      <div className="kb__cols">
        {cols.map((c) => (
          <section key={c.key} className="kb__col">
            <div className="kb__colHead">
              <h2>{c.title}</h2>
              <span className="tnum">{c.orders.length}</span>
            </div>
            {c.orders.map((o) => (
              <article key={o.key} className={`kb__ord ${o.state === 'served' ? 'is-served' : ''}`}>
                <div className="kb__ordTop">
                  <div className="kb__ordId">{o.code}</div>
                  <div className="kb__ordTable">{o.table}</div>
                  <div className={`kb__ordAge ${AGE_TONE(o.ageMin)}`}>{o.ageMin} min</div>
                </div>
                {o.payment === 'pending' && <div className="kb__unpaid">Unpaid · pay at counter</div>}
                <Items order={o} />
                {o.note && <div className="kb__note">“{o.note}”</div>}
                <div className="kb__ordFoot">
                  <Money value={o.total} strong />
                  <div className="kb__actions">
                    {o.state === 'new' && (
                      <button type="button" className="kb__act" onClick={() => advance(o)}>
                        Start preparing
                      </button>
                    )}
                    {o.state === 'preparing' && (
                      <button type="button" className="kb__act" onClick={() => advance(o)}>
                        Mark ready
                      </button>
                    )}
                    {o.state === 'ready' && (
                      <button type="button" className="kb__act" onClick={() => advance(o)}>
                        Mark served
                      </button>
                    )}
                    {o.state === 'served' && (
                      <span className="kb__act kb__act--quiet" aria-label="Order served">
                        Served
                      </span>
                    )}
                    <button
                      type="button"
                      className="kb__act kb__act--quiet"
                      title="Replay voice announcement"
                      aria-label={`Replay order ${o.code}`}
                      onClick={() => speak(`Order ${o.code} for table ${o.table}`)}
                    >
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

/**
 * A kitchen display is a wall-mounted screen nobody clicks: it has to pull,
 * not wait to be pushed.
 *
 * Two things keep it cheap and polite:
 *   - it stops while the tab is hidden, so a backgrounded tablet costs nothing
 *   - it refreshes on becoming visible again, so a cook never walks up to a
 *     board showing last night's tickets
 *
 * router.refresh() re-runs the Server Component and patches the tree in place,
 * so the audio toggle, the last-announcement text and the scroll position all
 * survive. A full reload would lose them several times a minute.
 *
 * Realtime (Postgres LISTEN/NOTIFY) would be better and is noted as a gap in
 * migration 0001. Polling is what works without extra infrastructure, and at
 * one tablet per kitchen the load is negligible.
 */
function useAutoRefresh(enabled: boolean, seconds = 15) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
    };

    const timer = setInterval(refresh, seconds * 1000);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, seconds, router]);
}
