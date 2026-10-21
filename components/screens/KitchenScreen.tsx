'use client';

import { rupeesToPaise } from '@/lib/money';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { kitchenOrders, restaurant, type KitchenOrder } from '@/lib/demo-data';
import { Money, VegMark } from '@/components/ui';
import type { KitchenScreenData, KitchenTicket } from '@/lib/db/kitchen-screen';
import { nextPrepState, type PrepState } from '@/lib/db/prep';
import { advanceOrderAction } from '@/app/kitchen/actions';
import { SignInPrompt } from '@/components/SignInPrompt';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import {
  advanceText,
  announceLogLabel,
  chooseLanguage,
  createAnnounceQueue,
  orderAnnouncement,
  primeOnOpen,
  selectNewTickets,
  type AnnounceLang,
  type AnnounceQueue,
} from '@/lib/announce';
import {
  browserSpeechEnv,
  createChime,
  createKitchenSpeech,
  type SpeechEngine,
} from '@/lib/speech';

const AGE_TONE = (age: number) => (age >= 20 ? 'is-late' : age >= 10 ? 'is-warn' : 'is-fresh');

/** How many past announcements the on-screen log keeps. */
const LOG_LIMIT = 6;

/**
 * Storage keys. Prefixed per restaurant where it matters, so a tablet moved
 * between venues does not inherit the other one's memory of what it has said.
 */
const AUDIO_KEY = 'autodine:kitchen:audio';
const SPEAKS_KEY = 'autodine:kitchen:speaks';
const LANG_KEY = 'autodine:kitchen:lang';
const seenKey = (restaurantId: string | null) => `autodine:kitchen:seen:${restaurantId ?? 'demo'}`;

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
  placedAtIso?: string;
  ageMin: number;
  payment: 'paid' | 'pending' | 'failed';
  state: KitchenOrder['state'];
  note?: string;
  items: { qty: number; name: string; detail?: string; veg: boolean }[];
  total: number;
};

type LogEntry = { key: string; at: string; label: string; text: string; lang: AnnounceLang };

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
    placedAtIso: ticket.placedAtIso,
    ageMin: ticket.ageMin,
    payment: ticket.payment,
    state: ticket.state,
    note: ticket.note,
    items: ticket.items,
    total: ticket.total,
  };
}

function clockNow(): string {
  return new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
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
   keyed by order UUID.

   THE ANNOUNCEMENT CONTRACT

   A guest presses "Place order" on a phone. The kitchen must hear, within
   about a second, the table and the dishes with their portions, in a language
   the room actually speaks. Four things have to be true:

     delivery   realtime pushes the row; a poll every few seconds is the
                safety net when the socket drops
     language   Hindi by default. A device with no Hindi voice announces in
                English and SAYS SO, because Devanagari read by an English
                synthesiser is silence, not accented Hindi
     wording    lib/announce.ts builds the sentence. Portions and the guest's
                note are spoken, because the voice is the only version some
                cooks get
     honesty    when sound is off, blocked or broken, the board says so in
                words. A silent board that looks live is the failure that
                costs a table its dinner
   ========================================================================== */
export function Kitchen({ data }: { data?: KitchenScreenData | null }) {
  const router = useRouter();

  const [audio, setAudio] = useState(true);
  const [speaksHere, setSpeaksHere] = useState(true);
  const [lang, setLang] = useState<AnnounceLang>('hi');
  const [hindiAvailable, setHindiAvailable] = useState(true);
  /**
   * False until the platform has finished enumerating its voices.
   *
   * On most browsers getVoices() is empty for the first few hundred
   * milliseconds. An announcement made in that window finds no voice, is
   * consumed silently, and is then marked as seen -- so the very first order
   * after a cold start is the one that never gets read out. The pass below
   * waits for this flag instead, and the ticket stays unmarked until it can
   * actually be spoken.
   */
  const [voicesReady, setVoicesReady] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Record<string, PrepState>>({});
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [voiceProblem, setVoiceProblem] = useState<'none' | 'unavailable' | 'stalled'>('none');
  const [lostCount, setLostCount] = useState(0);
  const [delivery, setDelivery] = useState<'connecting' | 'live' | 'polling'>('polling');
  const [queued, setQueued] = useState(0);
  const [missed, setMissed] = useState<BoardTicket[]>([]);
  const [ready, setReady] = useState(false);
  const [gestureDone, setGestureDone] = useState(false);

  const live = Boolean(data);
  const restaurantId = data?.restaurantId ?? null;

  // The speaker closure is built once, so it reads these through refs rather
  // than capturing the values they had at first render.
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const speaksRef = useRef(speaksHere);
  speaksRef.current = speaksHere;
  const langRef = useRef<AnnounceLang>(lang);
  langRef.current = lang;

  const speechRef = useRef<SpeechEngine | null>(null);
  const queueRef = useRef<AnnounceQueue | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  /* ------------------------------------------------------------- preferences */

  useEffect(() => {
    // Read after mount, never during render: localStorage does not exist on
    // the server and reading it while rendering is a hydration mismatch.
    try {
      if (localStorage.getItem(AUDIO_KEY) === 'off') setAudio(false);
      if (localStorage.getItem(SPEAKS_KEY) === 'off') setSpeaksHere(false);
      const stored = localStorage.getItem(LANG_KEY);
      if (stored === 'hi' || stored === 'en') setLang(stored);
    } catch {
      /* private mode: defaults are fine */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(AUDIO_KEY, audio ? 'on' : 'off');
      localStorage.setItem(SPEAKS_KEY, speaksHere ? 'on' : 'off');
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* nothing to persist to */
    }
  }, [audio, speaksHere, lang, ready]);

  /* ------------------------------------------------------------------ speech */

  useEffect(() => {
    const chime = createChime();
    const engine = createKitchenSpeech(browserSpeechEnv(chime));
    speechRef.current = engine;

    // Voices load asynchronously on most platforms. The first announcement
    // after a cold start is exactly when that matters.
    const refresh = () => {
      engine.refreshVoices();
      const hasHindi = engine.available('hi');
      setHindiAvailable(hasHindi);
      // "Ready" means the engine answered with SOMETHING. A device with no
      // voice at all still has to be released, or the board would wait for
      // ever; the unavailable() strip covers that case honestly.
      if (engine.voiceName('en') !== null || engine.unavailable()) setVoicesReady(true);
      setVoiceName(engine.voiceName(hasHindi ? 'hi' : 'en'));
      setVoiceProblem(engine.unavailable() ? 'unavailable' : 'none');
    };
    refresh();

    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    synth?.addEventListener?.('voiceschanged', refresh);

    queueRef.current = createAnnounceQueue({
      speak(text, onEnd, entryLang) {
        const current = speechRef.current;

        // Sound off, or this device is not the one that speaks: consume the
        // announcement without sound. Consuming rather than skipping is
        // deliberate -- otherwise a backlog would build while muted and play
        // all at once the moment it was switched on.
        if (!current || !audioRef.current || !speaksRef.current) {
          onEnd();
          return;
        }

        current.speak(
          text,
          () => {
            if (current.stalled()) {
              // The browser refused to start the utterance. The sentence is
              // in the log, so the pass can replay it, but say so rather than
              // letting the board look like it announced something.
              setVoiceProblem('stalled');
              setLostCount((count) => count + 1);
            } else {
              setVoiceProblem(current.unavailable() ? 'unavailable' : 'none');
            }
            onEnd();
          },
          entryLang ?? langRef.current,
        );
      },
    });

    return () => {
      synth?.removeEventListener?.('voiceschanged', refresh);
      engine.cancel();
      speechRef.current = null;
      queueRef.current = null;
    };
  }, []);

  // The resolved language: what will ACTUALLY be spoken, which is what the
  // board must promise. Not the preference.
  const choice = chooseLanguage(lang, hindiAvailable);
  const activeLang = choice.lang;

  // Refs so callbacks built before a language change still use the current one.
  const activeLangRef = useRef<AnnounceLang>(activeLang);
  activeLangRef.current = activeLang;

  const speak = useCallback(
    (key: string, text: string, label: string, priority: 'order' | 'info' = 'order'): boolean => {
      const spoken = queueRef.current?.push(key, text, priority, activeLangRef.current) ?? false;

      // Only log what was actually queued. Logging a dropped announcement
      // would show the pass a sentence the kitchen never heard.
      if (!spoken) return false;

      setAnnouncement(text);
      setLog((current) =>
        [{ key, at: clockNow(), label, text, lang: activeLangRef.current }, ...current].slice(0, LOG_LIMIT),
      );
      setQueued(queueRef.current?.depth() ?? 0);
      return true;
    },
    [],
  );

  /**
   * Replay one, on demand, whether or not it has been said before.
   *
   * `langForEntry` is the language the stored text was written in, which is
   * not always the language selected now -- a log entry from before a switch
   * still says what it said. Reading it in the wrong voice is silence.
   */
  const replay = useCallback((key: string, text: string, label: string, langForEntry?: AnnounceLang) => {
    // force(), not push(): a replay pressed while the original is still
    // waiting would otherwise be refused as a duplicate and appear to do
    // nothing at all.
    const queued = queueRef.current?.force(key, text, 'order', langForEntry) ?? false;
    if (!queued) return;

    setAnnouncement(text);
    setLog((current) =>
      [
        { key, at: clockNow(), label, text, lang: langForEntry ?? activeLangRef.current },
        ...current,
      ].slice(0, LOG_LIMIT),
    );
    setQueued(queueRef.current?.depth() ?? 0);
  }, []);

  /* ---------------------------------------------------------------- the board */

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

  /* ------------------------------------------------------------ what to say */

  useEffect(() => {
    if (!live) return;

    if (!primedRef.current) {
      primedRef.current = true;

      // Restore what a previous session already read out, so a refresh or a
      // wake from sleep does not replay the last half hour.
      const persisted = readSeen(restaurantId);
      const { seen, missed: offered } = primeOnOpen(orders, persisted, Date.now());

      seenRef.current = new Set(seen);
      writeSeen(restaurantId, seen);
      setMissed(offered);
      return;
    }

    const fresh = selectNewTickets(orders, seenRef.current);
    if (fresh.length === 0) return;

    // Wait for the voice list. Returning WITHOUT marking them seen is the
    // point: the effect re-runs when voicesReady flips and speaks them then.
    if (!voicesReady) return;

    for (const ticket of fresh) {
      // Mark it seen only once the queue has accepted it. If the backlog is
      // full the queue refuses; leaving the ticket unmarked means the next
      // poll (or the next order) announces it instead of losing it for good.
      const accepted = speak(
        `new:${ticket.orderId}`,
        orderAnnouncement(ticket, activeLangRef.current),
        announceLogLabel(ticket.table, ticket.items),
        'order',
      );
      if (!accepted) break;
      seenRef.current.add(ticket.orderId!);
    }

    writeSeen(restaurantId, [...seenRef.current]);
    setMissed((current) => current.filter((t) => !seenRef.current.has(t.orderId!)));
  }, [orders, live, restaurantId, speak, voicesReady]);

  /* --------------------------------------------------------------- delivery */

  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    router.refresh();
  }, [router]);

  /**
   * Realtime first, polling as the safety net.
   *
   * A websocket can drop and a kitchen cannot go silent, so the poll never
   * stops -- it only slows down while the socket is known good. When the
   * socket dies the interval tightens on its own.
   */
  useEffect(() => {
    if (!live || !restaurantId) return;

    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      // A burst of four orders commits within a few milliseconds of each
      // other. One refresh covers all four; four refreshes would race.
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, 300);
    };

    const channel = supabase
      .channel(`kitchen-orders-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        schedule,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setDelivery('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setDelivery('polling');
        else setDelivery('connecting');
      });

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [live, restaurantId, refresh]);

  useAutoRefresh(live, delivery === 'live' ? 30 : 5, refresh);

  /* ------------------------------------------------------------------ unlock */

  /**
   * Browsers refuse to play audio until the page has been interacted with.
   * A kitchen tablet is often opened and left alone, so the first
   * announcement of the evening is exactly the one that gets swallowed.
   *
   * The board therefore asks for one tap -- and it takes the tap from anywhere
   * on the page, so it is not a button someone has to find.
   */
  useEffect(() => {
    if (!ready || gestureDone) return;

    const unlock = () => {
      setGestureDone(true);
      // A resumed AudioContext plus one silent utterance is what tells Chrome
      // and Safari that this origin may now make noise.
      speechRef.current?.refreshVoices();
      setVoiceName(speechRef.current?.voiceName(hindiAvailable ? 'hi' : 'en') ?? null);
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [ready, gestureDone, hindiAvailable]);

  /* ---------------------------------------------------------------- actions */

  const advance = async (ticket: BoardTicket) => {
    if (!ticket.orderId) {
      setError('This board is showing sample data. Connect the database to cook real tickets.');
      return;
    }

    const next = nextPrepState(ticket.state);
    if (!next) return;

    speak(
      `adv:${ticket.orderId}:${next}`,
      advanceText(ticket.table, next, activeLangRef.current),
      ticket.table,
      'info',
    );
    setError('');
    setPending((current) => ({ ...current, [ticket.orderId!]: next }));

    const result = await advanceOrderAction(ticket.orderId);

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

  const latest = orders.find((order) => order.state !== 'served') ?? orders[0];

  const sampleText =
    activeLang === 'hi'
      ? 'नया ऑर्डर, टेबल टी वन। एक Butter Chicken, आधा। नोट: प्याज़ नहीं।'
      : 'New order, table T1. One Butter Chicken, Half.';

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

          {/* Language. Two states, both real: the board never offers Hindi on
              a device that cannot speak it without saying why it is English. */}
          <div className="kb__langs" role="group" aria-label="Announcement language">
            {(['hi', 'en'] as const).map((value) => {
              // Hindi with no Hindi voice on this device is a button that
              // cannot do what it says. Rather than let it look pressed while
              // the board speaks English, it goes disabled and explains why.
              const blocked = value === 'hi' && !hindiAvailable;
              return (
                <button
                  key={value}
                  type="button"
                  className={`kb__lang ${activeLang === value ? 'is-on' : ''}`}
                  aria-pressed={activeLang === value}
                  disabled={blocked}
                  title={blocked ? 'इस डिवाइस में हिंदी की आवाज़ नहीं है' : undefined}
                  onClick={() => setLang(value)}
                >
                  {value === 'hi' ? 'हिंदी' : 'English'}
                </button>
              );
            })}
          </div>

          {live && (
            <button
              type="button"
              className={`kb__toggle ${speaksHere ? 'is-on' : ''}`}
              onClick={() => setSpeaksHere((value) => !value)}
              title="Turn this off on a second screen in the same kitchen, so orders are not read out twice"
            >
              {speaksHere ? 'This screen speaks' : 'Screen muted'}
            </button>
          )}
          <button
            type="button"
            className="kb__ghost"
            onClick={() => replay(`test:${Date.now()}`, sampleText, 'Test')}
          >
            Test announcement
          </button>
          <button
            type="button"
            className="kb__ghost"
            disabled={!latest?.orderId}
            onClick={() => {
              if (!latest?.orderId) return;
              replay(
                `new:${latest.orderId}`,
                orderAnnouncement(latest, activeLangRef.current),
                announceLogLabel(latest.table, latest.items),
              );
            }}
          >
            Replay latest
          </button>
          <div className="kb__live">
            <span className="kb__liveDot" />
            {live
              ? delivery === 'live'
                ? 'Live · instant'
                : delivery === 'connecting'
                  ? 'Live · connecting…'
                  : 'Live · checking every 5s'
              : 'Demo board · local only'}
          </div>
          {queued > 1 && <span className="kb__pill">{queued} queued</span>}
        </div>
      </header>

      {/* ------------------------------------------------------ honesty strips */}

      {!gestureDone && audio && speaksHere && (
        <div className="kb__warn kb__warn--quiet" role="status">
          <strong>Tap once anywhere on this board.</strong>
          <span>
            Some browsers block sound until the page has been touched. One tap now means the first
            order of the day is not the one that gets swallowed.
          </span>
        </div>
      )}

      {lang === 'hi' && !hindiAvailable && (
        <div className="kb__warn" role="alert">
          <strong>No Hindi voice on this device.</strong>
          <span>
            Orders are being announced in <strong>English</strong> so the kitchen still hears them.
            To get Hindi: install a Hindi text-to-speech voice (Android: Settings → Language &amp;
            input → Text-to-speech → install Hindi; iPad: Settings → Accessibility → Spoken Content →
            Voices → Hindi).
          </span>
          <button type="button" className="kb__ghost" onClick={() => setLang('en')}>
            Announce in English
          </button>
        </div>
      )}

      {audio && speaksHere && voiceProblem === 'unavailable' && (
        <div className="kb__warn" role="alert">
          <strong>This device has no speech voice.</strong>
          <span>
            Orders still appear on the board and the chime still sounds, but the dishes will not be
            read out. Install a text-to-speech voice, or open this board on another device.
          </span>
        </div>
      )}

      {audio && speaksHere && voiceProblem === 'stalled' && lostCount > 0 && (
        <div className="kb__warn" role="alert">
          <strong>
            {lostCount} announcement{lostCount === 1 ? '' : 's'} could not be read out.
          </strong>
          <span>
            The browser blocked the voice. Tap this board once to allow sound, press “Test
            announcement”, then replay from the list below — the sentences are all there.
          </span>
          <button
            type="button"
            className="kb__ghost"
            onClick={() => {
              speechRef.current?.clearStall();
              setVoiceProblem('none');
              setLostCount(0);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {!audio && (
        <div className="kb__warn" role="alert">
          <strong>Sound is off.</strong>
          <span>
            New orders will appear on this board but will not be announced out loud. The kitchen
            will not hear them.
          </span>
          <button type="button" className="kb__ghost" onClick={() => setAudio(true)}>
            Turn sound on
          </button>
        </div>
      )}

      {audio && !speaksHere && live && (
        <div className="kb__warn kb__warn--quiet" role="status">
          <strong>This screen is muted.</strong>
          <span>
            Another screen in this kitchen is doing the announcing. Turn this one on if it should
            speak too — two screens speaking means every order is read out twice.
          </span>
          <button type="button" className="kb__ghost" onClick={() => setSpeaksHere(true)}>
            Speak here too
          </button>
        </div>
      )}

      {missed.length > 0 && (
        <div className="kb__warn kb__warn--quiet" role="status">
          <strong>
            {missed.length} order{missed.length === 1 ? '' : 's'} came in before this board was open.
          </strong>
          <span>They are on the board. Read them out if the pass has not seen them yet.</span>
          <button
            type="button"
            className="kb__ghost"
            onClick={() => {
              for (const ticket of [...missed].reverse()) {
                speak(
                  `new:${ticket.orderId}`,
                  orderAnnouncement(ticket, activeLangRef.current),
                  announceLogLabel(ticket.table, ticket.items),
                );
              }
              setMissed([]);
            }}
          >
            Read them aloud
          </button>
          <button type="button" className="kb__ghost" onClick={() => setMissed([])}>
            Dismiss
          </button>
        </div>
      )}

      {log.length > 0 && (
        <section className="kb__log" aria-label="Recent announcements">
          <div className="kb__logHead">
            {/* "Spoken" would be a lie while muted: the entries are what the
                board WOULD have read out. */}
            <span>Announcements</span>
            <span className="kb__logVoice">
              {audio && speaksHere
                ? `${voiceName ?? 'no voice selected'}${activeLang === 'hi' ? ' · हिंदी' : ''}`
                : 'muted on this screen — nothing was read aloud'}
            </span>
          </div>
          <ul>
            {log.map((entry) => (
              <li key={`${entry.key}-${entry.at}`}>
                <span className="kb__logAt">{entry.at}</span>
                <span className="kb__logLabel">{entry.label}</span>
                <span className="kb__logText">{entry.text}</span>
                <button
                  type="button"
                  className="kb__linkBtn"
                  aria-label={`Replay ${entry.label}`}
                  onClick={() =>
                    replay(`${entry.key}:replay:${entry.at}`, entry.text, entry.label, entry.lang)
                  }
                >
                  Replay
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {announcement && (
        <span className="ui-hint" role="status" style={{ display: 'block', marginBottom: 8 }}>
          Last announcement: {announcement}
        </span>
      )}

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
          the moment the guest confirms.
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
                  <Money value={rupeesToPaise(o.total)} strong />
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
                      disabled={!o.orderId}
                      onClick={() =>
                        replay(
                          `new:${o.orderId ?? o.key}`,
                          orderAnnouncement(o, activeLangRef.current),
                          announceLogLabel(o.table, o.items),
                        )
                      }
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

/* ------------------------------------------------------------------ storage */

function readSeen(restaurantId: string | null): string[] {
  try {
    const raw = sessionStorage.getItem(seenKey(restaurantId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeen(restaurantId: string | null, ids: string[]): void {
  try {
    // Capped: a board left open for a week would otherwise grow this without
    // bound. Only the recent tail can still be relevant.
    sessionStorage.setItem(seenKey(restaurantId), JSON.stringify(ids.slice(-500)));
  } catch {
    /* private mode or quota: the in-memory set still works */
  }
}

/**
 * A kitchen display is a wall-mounted screen nobody clicks: it has to pull,
 * not wait to be pushed.
 *
 * The interval is chosen by the caller -- short while realtime is down, long
 * while it is known good, so the websocket is the fast path and the poll is
 * only ever the safety net.
 *
 * It stops while the tab is hidden, so a backgrounded tablet costs nothing,
 * and refreshes on becoming visible again, so a cook never walks up to a board
 * showing last night's tickets.
 *
 * router.refresh() re-runs the Server Component and patches the tree in place,
 * so the audio toggle, the announcement log and the scroll position all
 * survive. A full reload would lose them several times a minute.
 */
function useAutoRefresh(enabled: boolean, seconds: number, refresh: () => void) {
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(refresh, seconds * 1000);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, seconds, refresh]);
}
