'use client';

import { rupeesToPaise } from '@/lib/money';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { kitchenOrders, restaurant, type KitchenOrder } from '@/lib/demo-data';
import { Money, VegMark } from '@/components/ui';
import type { KitchenScreenData, KitchenTicket } from '@/lib/db/kitchen-screen';
import { nextPrepState, type PrepState } from '@/lib/db/prep';
import { advanceOrderAction } from '@/app/kitchen/actions';
import { cancelStaffOrderAction } from '@/app/orders/actions';
import { SignInPrompt } from '@/components/SignInPrompt';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import {
  advanceText,
  announceLogLabel,
  cancelText,
  createAnnounceQueue,
  newOrderText,
  orderAnnouncement,
  primeOnOpen,
  selectNewTickets,
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
 * How long the board waits for the platform to enumerate its voices before it
 * assumes there are none. Browsers answer in a few hundred milliseconds; five
 * seconds is the point at which "still loading" is no longer the honest answer.
 */
const VOICE_WAIT_MS = 5000;

/**
 * Storage keys. Prefixed per restaurant where it matters, so a tablet moved
 * between venues does not inherit the other one's memory of what it has said.
 */
const AUDIO_KEY = 'autodine:kitchen:audio';
const SPEAKS_KEY = 'autodine:kitchen:speaks';
const VOICE_KEY = 'autodine:kitchen:voice';
const SPEED_KEY = 'autodine:kitchen:speed';

/**
 * How fast to read.
 *
 * Three steps, not a slider: an operator in a kitchen has one hand free and no
 * patience for a control that needs aiming. "धीमा" exists because a hurried
 * Hindi voice is what sounds slurred, and the right pace depends on the room --
 * a tiled hall with an echo needs slower than a small counter.
 */
const SPEEDS = { slow: 0.85, normal: 1, fast: 1.1 } as const;

type Speed = keyof typeof SPEEDS;
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
  items: {
    qty: number;
    name: string;
    detail?: string;
    /** The portion alone, when the dish has one. */
    portion?: string;
    /** Add-ons alone, shown as tags on the ticket. */
    addons?: string[];
    veg: boolean;
    spoken?: string | null;
  }[];
  total: number;
};

type LogEntry = { key: string; at: string; label: string; text: string };

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

/**
 * What the board can do about sound, as one value rather than six booleans.
 *
 * This exists because the previous version could show four warnings at once,
 * in an order nobody could predict, and a kitchen learns to ignore a screen
 * that is always shouting. Exactly one state wins, the most severe one, and
 * one banner explains it.
 */
type Status = {
  tone: 'alert' | 'quiet';
  title: string;
  body: string;
  action?: { label: string; run: () => void };
};

function Items({ order, compact }: { order: BoardTicket; compact?: boolean }) {
  return (
    <ul className={compact ? 'kb-items kb-items--compact' : 'kb-items'}>
      {order.items.map((it, i) => (
        <li key={i}>
          <span className="kb-qty">{it.qty}×</span>
          <span className="kb-itemName">
            <VegMark veg={it.veg} size={11} /> {it.name}
            {/* Portion first, then each add-on as its own tag. A ticket that
                reads "Butter Naan · Half · Extra cheese · Jain" makes the cook
                hunt for the part they must not get wrong; the tags survive a
                glance from a metre away. */}
            {it.portion ? <em> · {it.portion}</em> : !it.addons && it.detail && <em> · {it.detail}</em>}
            {it.addons?.map((addon) => (
              <span key={addon} className="kb-itemAddon">
                {addon}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================================
   Editorial Minimal — locked design system kitchen board

   THE ANNOUNCEMENT CONTRACT

   A guest presses "Place order" on a phone. The kitchen must hear, within
   about a second, the table and the dishes with their portions, out loud, in
   Hindi. Five things have to be true:

     delivery   realtime pushes the row; a poll every few seconds is the
                safety net when the socket drops
     one voice  Hindi, and only Hindi. There is no English fallback, because a
                Devanagari sentence read by an English voice is silence, and a
                silent board that looks live is the failure that costs a table
                its dinner
     wording    lib/announce.ts builds the sentence; lib/hindi.ts makes every
                word of it Devanagari, including the dish names
     pacing     one sentence at a time, with a gap, at a human rate
     honesty    when sound cannot happen at all -- no Hindi voice, no tap yet,
                sound off, engine wedged -- the board says so in one banner,
                in the words the operator needs, and says how to fix it
   ========================================================================== */
export function Kitchen({ data }: { data?: KitchenScreenData | null }) {
  const router = useRouter();

  const [audio, setAudio] = useState(true);
  const [speaksHere, setSpeaksHere] = useState(true);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  /** Every Hindi voice installed here, so a bad default can be swapped. */
  const [voiceList, setVoiceList] = useState<{ name: string; lang: string }[]>([]);
  const [voicePref, setVoicePref] = useState('');
  const [speed, setSpeed] = useState<Speed>('normal');
  /** 'starting' until the platform either names a Hindi voice or has none. */
  const [voiceState, setVoiceState] = useState<'starting' | 'ready' | 'no-voice'>('starting');
  const [stalled, setStalled] = useState(false);
  const [lostCount, setLostCount] = useState(0);
  const [gestureDone, setGestureDone] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Record<string, PrepState>>({});
  /**
   * Tickets removed from this board because they were cancelled.
   *
   * The board re-reads the queue every thirty seconds, but a cancelled ticket
   * has to leave the moment it is cancelled: a cook working from a board that
   * still shows it is cooking food nobody ordered. The server refresh clears
   * this on its own -- a cancelled row simply is not in the payload.
   */
  const [cancelled, setCancelled] = useState<string[]>([]);
  /** Which ticket is asking "are you sure", so a mis-tap cannot cancel. */
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<'connecting' | 'live' | 'polling'>('polling');
  /**
   * What the queue is doing, not what it was asked to do.
   *
   * These used to be set at push time, which meant the board showed the
   * fourth ticket of a burst as "last announcement" while the first was still
   * being read, and a "4 queued" pill that never went down because nothing
   * ever recounted it. The queue reports both now.
   */
  const [speaking, setSpeaking] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [missed, setMissed] = useState<BoardTicket[]>([]);
  /**
   * Why those tickets were not read out.
   *
   * Two different situations that used to share one sentence: this device
   * cannot speak at all (no Hindi voice), or the operator muted this screen.
   * The first needs a fix and the second needs a decision, so the banner says
   * which one it is.
   */
  const [missedReason, setMissedReason] = useState<'voice' | 'muted'>('voice');
  const [ready, setReady] = useState(false);

  const live = Boolean(data);
  const restaurantId = data?.restaurantId ?? null;

  // The speaker closure is built once, so it reads these through refs rather
  // than capturing the values they had at first render.
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const speaksRef = useRef(speaksHere);
  speaksRef.current = speaksHere;

  const speechRef = useRef<SpeechEngine | null>(null);
  const speedRef = useRef<Speed>('normal');
  const queueRef = useRef<AnnounceQueue | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  /** Cancellations already announced, so a refresh cannot repeat one. */
  const cancelSeenRef = useRef<Set<string>>(new Set());
  const cancelPrimedRef = useRef(false);
  /** True once the board knows whether a Hindi voice exists. */
  const settledRef = useRef(false);
  /** The same answer, readable from the announcement pass without a re-render. */
  const canAnnounceRef = useRef(false);
  const [settled, setSettled] = useState(false);

  /* ------------------------------------------------------------- preferences */

  useEffect(() => {
    // Read after mount, never during render: localStorage does not exist on
    // the server and reading it while rendering is a hydration mismatch.
    try {
      if (localStorage.getItem(AUDIO_KEY) === 'off') setAudio(false);
      if (localStorage.getItem(SPEAKS_KEY) === 'off') setSpeaksHere(false);
      setVoicePref(localStorage.getItem(VOICE_KEY) ?? '');

      const storedSpeed = localStorage.getItem(SPEED_KEY);
      if (storedSpeed === 'slow' || storedSpeed === 'normal' || storedSpeed === 'fast') {
        setSpeed(storedSpeed);
        speedRef.current = storedSpeed;
      }
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
      localStorage.setItem(VOICE_KEY, voicePref);
      localStorage.setItem(SPEED_KEY, speed);
    } catch {
      /* nothing to persist to */
    }
  }, [audio, speaksHere, voicePref, speed, ready]);

  /* ------------------------------------------------------------------ speech */

  useEffect(() => {
    const chime = createChime();
    const engine = createKitchenSpeech(browserSpeechEnv(chime));
    speechRef.current = engine;

    /**
     * Resolve the voice question, once, and keep it current.
     *
     * Voices load asynchronously on most platforms; the first announcement
     * after a cold start is exactly when that matters. "Settled" is what
     * releases the announcement pass -- until then a ticket stays unread
     * rather than being spent on an engine that has not answered yet.
     */
    const refresh = () => {
      engine.refreshVoices();
      engine.setRateScale(SPEEDS[speedRef.current]);

      // A preference saved on another tablet may not exist here; the engine
      // says so and we keep the best available rather than pretending.
      const stored = localStorage.getItem(VOICE_KEY);
      if (stored) engine.setVoiceName(stored);

      setVoiceList(engine.hindiVoices().map((v) => ({ name: v.name, lang: v.lang })));

      const name = engine.voiceName();

      canAnnounceRef.current = name !== null;

      if (name) {
        setVoiceName(name);
        setVoiceState('ready');
        settledRef.current = true;
        setSettled(true);
        return;
      }

      setVoiceName(null);

      // No Hindi voice, and the list has finished loading: this device cannot
      // announce. Saying so is the point.
      if (engine.unavailable()) {
        setVoiceState('no-voice');
        settledRef.current = true;
        setSettled(true);
      }
    };
    refresh();

    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    synth?.addEventListener?.('voiceschanged', refresh);

    // A browser that never fires voiceschanged and never answers with a list
    // must not hold the board at "starting" for the whole service.
    const giveUp = setTimeout(() => {
      if (settledRef.current) return;
      refresh();
      if (!settledRef.current) {
        setVoiceState('no-voice');
        settledRef.current = true;
        setSettled(true);
      }
    }, VOICE_WAIT_MS);

    queueRef.current = createAnnounceQueue(
      {
        speak(text, onEnd) {
          const current = speechRef.current;

          // Sound off, no Hindi voice, or this device is not the one that
          // speaks: consume the announcement without sound. Consuming rather
          // than skipping is deliberate -- otherwise a backlog would build
          // while muted and play all at once when it was switched on.
          if (!current || !audioRef.current || !speaksRef.current || !current.available()) {
            onEnd();
            return;
          }

          current.speak(text, () => {
            if (current.stalled()) {
              // The browser refused to start the utterance. The sentence stays
              // in the log so the pass can replay it, but the board says so
              // rather than looking like it announced something.
              setStalled(true);
              setLostCount((count) => count + 1);
            }
            onEnd();
          });
        },
      },
      {
        // Only what actually reached the speaker is called "speaking now".
        onBegin(_key, text) {
          setAnnouncement(text);
          setSpeaking(true);
          setWaiting(queueRef.current?.pending() ?? 0);
        },
        onIdle() {
          setSpeaking(false);
          setWaiting(0);
        },
      },
    );

    return () => {
      clearTimeout(giveUp);
      synth?.removeEventListener?.('voiceschanged', refresh);
      engine.cancel();
      speechRef.current = null;
      queueRef.current = null;
    };
  }, []);

  const speak = useCallback(
    (key: string, text: string, label: string, priority: 'order' | 'info' = 'order'): boolean => {
      const accepted = queueRef.current?.push(key, text, priority) ?? false;

      // Only log what was actually queued. Logging a dropped announcement
      // would show the pass a sentence the kitchen never heard.
      if (!accepted) return false;

      setLog((current) => [{ key, at: clockNow(), label, text }, ...current].slice(0, LOG_LIMIT));
      setWaiting(queueRef.current?.pending() ?? 0);
      return true;
    },
    [],
  );

  /**
   * Replay one, on demand, whether or not it has been said before.
   *
   * force(), not push(): a replay pressed while the original is still waiting
   * would otherwise be refused as a duplicate and appear to do nothing.
   */
  const replay = useCallback((key: string, text: string, label: string) => {
    const accepted = queueRef.current?.force(key, text, 'order') ?? false;
    if (!accepted) return;

    setLog((current) => [{ key, at: clockNow(), label, text }, ...current].slice(0, LOG_LIMIT));
    setWaiting(queueRef.current?.pending() ?? 0);
  }, []);

  /* ---------------------------------------------------------------- the board */

  const base: BoardTicket[] = (live
    ? (data?.tickets ?? []).map(fromLive)
    : kitchenOrders.map(fromDemo)
  ).filter((ticket) => !ticket.orderId || !cancelled.includes(ticket.orderId));

  // Optimistic overlay. Applied on top of `base`, so a refresh from the server
  // simply wins without any resync bookkeeping.
  const orders = base.map((ticket) =>
    ticket.orderId && pending[ticket.orderId]
      ? { ...ticket, state: pending[ticket.orderId]! }
      : ticket,
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

    // Nothing is spent until the board knows whether it can speak at all.
    // Returning WITHOUT marking them seen is the point: the effect re-runs
    // when the voice question is settled, and speaks them then.
    if (!settled) return;

    const readyToSpeak = canAnnounceRef.current;
    const canSpeak = audioRef.current && speaksRef.current && readyToSpeak;
    const announced = new Set<string>();

    for (const ticket of fresh) {
      if (!ticket.orderId) continue;

      if (!canSpeak) {
        // Unheard, and never pretended otherwise: the ticket joins the list
        // the pass can read out by hand once the voice problem is fixed.
        seenRef.current.add(ticket.orderId);
        setMissedReason(readyToSpeak ? 'muted' : 'voice');
        setMissed((current) => [ticket, ...current].slice(0, LOG_LIMIT));
        continue;
      }

      const accepted = speak(
        `new:${ticket.orderId}`,
        orderAnnouncement(ticket),
        announceLogLabel(ticket.table, ticket.items),
        'order',
      );

      // If the backlog is full the queue refuses; leaving the ticket unmarked
      // means the next poll announces it instead of losing it for good.
      if (!accepted) break;
      seenRef.current.add(ticket.orderId);
      announced.add(ticket.orderId);
    }

    writeSeen(restaurantId, [...seenRef.current]);

    // Anything just read out comes off the "not read out" list; anything the
    // board could not read stays on it until it is read.
    if (announced.size > 0) {
      setMissed((current) => current.filter((t) => !t.orderId || !announced.has(t.orderId)));
    }
  }, [orders, live, restaurantId, speak, settled, voiceState]);

  /* ------------------------------------------------------- cancelled tickets */

  useEffect(() => {
    if (!live || !data) return;

    const list = data.cancelled ?? [];

    // On open, everything already cancelled is history. Reading fifteen
    // minutes of cancellations out loud the moment the board wakes up would
    // teach the kitchen to ignore the announcement that matters.
    if (!cancelPrimedRef.current) {
      cancelPrimedRef.current = true;
      for (const row of list) cancelSeenRef.current.add(row.id);
      return;
    }

    for (const row of list) {
      if (cancelSeenRef.current.has(row.id)) continue;
      cancelSeenRef.current.add(row.id);

      // 'order' priority: this is a stop instruction, not a status note.
      speak(
        `cancel:${row.id}`,
        cancelText(row.table),
        `${row.table} · cancelled`,
        'order',
      );
    }
  }, [data, live, speak]);

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
   * Browsers refuse to play audio until the page has been interacted with. A
   * kitchen tablet is often opened and left alone, so the first announcement
   * of the evening is exactly the one that gets swallowed.
   *
   * The board therefore asks for one tap -- and it takes the tap from anywhere
   * on the page, so it is not a button someone has to find.
   */
  useEffect(() => {
    if (!ready || gestureDone) return;

    const unlock = () => {
      setGestureDone(true);
      speechRef.current?.refreshVoices();
      setVoiceName(speechRef.current?.voiceName() ?? null);
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [ready, gestureDone]);

  /* ------------------------------------------------------------------ status */

  /**
   * Exactly one thing to say about sound, most severe first.
   *
   * Order is deliberate: a board whose sound the operator turned off does not
   * also need to be told it has no Hindi voice, and a wedged engine matters
   * more than a missing tap.
   */
  const status: Status | null = useMemo(() => {
    if (!audio) {
      return {
        tone: 'alert',
        title: 'Sound is off.',
        body: 'New orders will appear on this board but will not be announced. The kitchen will not hear them.',
        action: { label: 'Turn sound on', run: () => setAudio(true) },
      };
    }

    if (live && !speaksHere) {
      return {
        tone: 'quiet',
        title: 'This screen is muted.',
        body: 'Another screen in this kitchen is doing the announcing. Two screens speaking would read every order out twice.',
        action: { label: 'Speak here too', run: () => setSpeaksHere(true) },
      };
    }

    if (stalled && lostCount > 0) {
      return {
        tone: 'alert',
        title: `${lostCount} announcement${lostCount === 1 ? '' : 's'} could not be read out.`,
        body: 'The browser blocked the voice. Tap the board once, press “Test announcement”, then replay anything from the list below.',
        action: {
          label: 'Dismiss',
          run: () => {
            speechRef.current?.clearStall();
            setStalled(false);
            setLostCount(0);
          },
        },
      };
    }

    if (voiceState === 'no-voice') {
      return {
        tone: 'alert',
        title: 'No Hindi voice on this device — nothing will be read out.',
        body: 'The board does not switch to English: Devanagari read by an English voice is silence, not Hindi. Install a Hindi text-to-speech voice — Android: Settings → System → Languages → Text-to-speech → install हिन्दी; iPad: Settings → Accessibility → Spoken Content → Voices → Hindi. Then reload this page.',
        action: {
          label: 'Check again',
          run: () => {
            speechRef.current?.refreshVoices();
            const name = speechRef.current?.voiceName() ?? null;
            setVoiceName(name);
            setVoiceState(name ? 'ready' : 'no-voice');
          },
        },
      };
    }

    if (!gestureDone) {
      return {
        tone: 'quiet',
        title: 'Tap once anywhere on this board.',
        body: 'Browsers block sound until the page has been touched. One tap now means the first order of the day is not the one that gets swallowed.',
      };
    }

    return null;
  }, [audio, live, speaksHere, stalled, lostCount, voiceState, gestureDone]);

  /* ---------------------------------------------------------------- actions */

  const advance = async (ticket: BoardTicket) => {
    if (!ticket.orderId) {
      setError('This board is showing sample data. Connect the database to cook real tickets.');
      return;
    }

    const next = nextPrepState(ticket.state);
    if (!next) return;

    speak(`adv:${ticket.orderId}:${next}`, advanceText(ticket.table, next), ticket.table, 'info');
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

  /**
   * Cancel a ticket from the board.
   *
   * Two taps: the first puts the ticket into an "are you sure" state, the
   * second cancels. A single-tap cancel on a board that is worked with wet
   * hands and elbows is an order lost per service.
   *
   * The announcement is queued at 'order' priority, not 'info'. Under load
   * informational lines are dropped on purpose; a cancellation is not
   * information, it is a stop instruction.
   */
  const cancelTicket = async (ticket: BoardTicket) => {
    if (!ticket.orderId) {
      setError('This board is showing sample data. Connect the database to cancel real tickets.');
      return;
    }
    if (confirmCancel !== ticket.orderId) {
      setConfirmCancel(ticket.orderId);
      setError('');
      return;
    }

    const id = ticket.orderId;
    setCancelBusy(id);
    setConfirmCancel(null);

    const result = await cancelStaffOrderAction({ orderId: id });
    setCancelBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setCancelled((current) => (current.includes(id) ? current : [...current, id]));
    cancelSeenRef.current.add(id);
    speak(`cancel:${id}`, cancelText(ticket.table), `${ticket.table} · cancelled`, 'order');
    // Pick up anything that moved on another screen at the same time.
    refresh();
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

  /**
   * The sentence "Test announcement" speaks.
   *
   * The same builder a real ticket uses, with one of each kind of clause in it
   * -- a portion, a second dish, a note -- so pressing it once tells the
   * operator what all three sound like at the speed they picked.
   */
  const sampleText = newOrderText(
    'T1',
    [
      { qty: 1, name: 'Butter Chicken', detail: 'Half' },
      { qty: 2, name: 'Butter Naan' },
    ],
    'no onion',
  );

  const readMissed = () => {
    for (const ticket of [...missed].reverse()) {
      speak(
        `missed:${ticket.orderId ?? ticket.key}:${Date.now()}`,
        orderAnnouncement(ticket),
        announceLogLabel(ticket.table, ticket.items),
      );
    }
    setMissed([]);
  };

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

          {/* What will actually be spoken, named. Not a language picker: there
              is one language, and a picker would imply a second one exists. */}
          <span
            className={`kb__pill ${voiceState === 'ready' ? 'is-ok' : ''}`}
            title={voiceName ? `Voice: ${voiceName}` : 'No Hindi voice on this device'}
          >
            {voiceState === 'starting'
              ? 'हिंदी · आवाज़ खोज रहे हैं'
              : voiceState === 'ready'
                ? 'हिंदी · तैयार'
                : 'हिंदी · आवाज़ नहीं'}
          </span>

          {/* Speed. A hurried Hindi voice is what sounds slurred, so the
              operator gets the last word on pace instead of a constant. */}
          <div className="kb__speeds" role="group" aria-label="आवाज़ की रफ़्तार — voice speed">
            {(['slow', 'normal', 'fast'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`kb__speed ${speed === value ? 'is-on' : ''}`}
                aria-pressed={speed === value}
                onClick={() => {
                  setSpeed(value);
                  speedRef.current = value;
                  speechRef.current?.setRateScale(SPEEDS[value]);
                }}
              >
                {value === 'slow' ? 'धीमा' : value === 'normal' ? 'सामान्य' : 'तेज़'}
              </button>
            ))}
          </div>

          {/* Which Hindi voice. A device can carry two, and they are not
              equally good -- an embedded engine and a downloaded neural one
              both answer to hi-IN. Only shown when there is a real choice. */}
          {voiceList.length > 1 && (
            <select
              className="kb__voicePick"
              aria-label="Hindi voice"
              value={voicePref}
              onChange={(event) => {
                const next = event.target.value;
                setVoicePref(next);
                speechRef.current?.setVoiceName(next || null);
                setVoiceName(speechRef.current?.voiceName() ?? null);
              }}
            >
              <option value="">सबसे अच्छी आवाज़ (auto)</option>
              {voiceList.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                </option>
              ))}
            </select>
          )}

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
                orderAnnouncement(latest),
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
          {waiting > 0 && <span className="kb__pill">{waiting} waiting</span>}
        </div>
      </header>

      {/* ------------------------------------------------------- the one banner */}

      {status && (
        <div className={`kb__warn ${status.tone === 'quiet' ? 'kb__warn--quiet' : ''}`} role={status.tone === 'alert' ? 'alert' : 'status'}>
          <strong>{status.title}</strong>
          <span>{status.body}</span>
          {status.action && (
            <button type="button" className="kb__ghost" onClick={status.action.run}>
              {status.action.label}
            </button>
          )}
        </div>
      )}

      {missed.length > 0 && (
        <div className="kb__warn kb__warn--quiet" role="status">
          <strong>
            {missed.length} order{missed.length === 1 ? '' : 's'} {missed.length === 1 ? 'has' : 'have'} not
            been read out.
          </strong>
          <span>
            {/* Two honest reasons, and they are not the same thing. */}
            {missedReason === 'muted'
              ? 'They arrived while this screen was muted or the sound was off.'
              : voiceState === 'ready'
                ? 'They were placed before this board was opened. The pass may have seen them already.'
                : 'They arrived while this device had no voice to read them with.'}{' '}
            They are on the board below.
          </span>
          <button type="button" className="kb__ghost" onClick={readMissed}>
            Read them out
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
                board WOULD have read out. The text is the exact string handed
                to the voice, Devanagari and all -- so the owner can read what
                the kitchen will hear. */}
            <span>Announcements</span>
            <span className="kb__logVoice">
              {audio && speaksHere
                ? voiceState === 'ready'
                  ? `हिंदी · ${voiceName ?? 'voice'}`
                  : 'हिंदी · no voice on this device'
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
                  onClick={() => replay(`${entry.key}:replay:${entry.at}`, entry.text, entry.label)}
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
          {/* "Last announcement" was a half-truth: it was the last thing the
              queue ACCEPTED, which in a burst is not the thing being said. */}
          {speaking ? 'Speaking now' : 'Last announcement'}: {announcement}
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
                          orderAnnouncement(o),
                          announceLogLabel(o.table, o.items),
                        )
                      }
                    >
                      🔊
                    </button>
                    {o.state !== 'served' && o.orderId ? (
                      confirmCancel === o.orderId ? (
                        <>
                          <button
                            type="button"
                            className="kb__act kb__act--danger"
                            disabled={cancelBusy === o.orderId}
                            onClick={() => cancelTicket(o)}
                          >
                            {cancelBusy === o.orderId ? 'Cancelling…' : 'Yes, cancel'}
                          </button>
                          <button
                            type="button"
                            className="kb__act kb__act--quiet"
                            onClick={() => setConfirmCancel(null)}
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="kb__act kb__act--quiet"
                          aria-label={`Cancel order for ${o.table}`}
                          onClick={() => cancelTicket(o)}
                        >
                          Cancel
                        </button>
                      )
                    ) : null}
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
