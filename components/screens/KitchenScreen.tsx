'use client';

import { rupeesToPaise } from '@/lib/money';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { kitchenOrders, restaurant, type KitchenOrder } from '@/lib/demo-data';
import { Money, VegMark } from '@/components/ui';
import {
  Dot,
  Empty,
  Notice,
  OwnerPage,
  PageHead,
  Panel,
  Segmented,
  SwitchTrack,
  Tag,
  btn,
} from '@/components/owner/chrome';
import type { OutletBar } from '@/lib/outlets';
import type { KitchenScreenData, KitchenTicket } from '@/lib/db/kitchen-screen';
import { clockTimeInZone } from '@/lib/db/time';
import { LATE_AFTER_MIN, WARN_AFTER_MIN, nextPrepState, type PrepState } from '@/lib/db/prep';
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

/* The thresholds live next to the query that computes the age, so the badge
   and the board cannot disagree about what "late" means. */
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
    <ul className={compact ? 'mt-2.5 grid gap-1.5' : 'mt-3 grid gap-2'}>
      {order.items.map((it, i) => (
        <li
          key={i}
          className={[
            'flex items-baseline gap-2.5',
            compact ? 'text-[13.5px]' : 'text-[15px] leading-[1.35]',
          ].join(' ')}
        >
          <span
            className={[
              'shrink-0 text-right font-semibold text-gink-64 tabular-nums',
              compact ? 'w-6 text-[12.5px]' : 'w-7',
            ].join(' ')}
          >
            {it.qty}×
          </span>
          <span className="min-w-0 text-gink">
            <span className="inline-flex items-center gap-1.5">
              <VegMark veg={it.veg} size={11} />
              <span className="font-medium">{it.name}</span>
            </span>
            {/* Portion first, then each add-on as its own tag. A ticket that
                reads "Butter Naan · Half · Extra cheese · Jain" makes the cook
                hunt for the part they must not get wrong; the tags survive a
                glance from a metre away. */}
            {/* The portion is the part a cook must not get wrong, so it is
                ink at the same size as the dish, not a grey aside. */}
            {it.portion ? (
              <span className="font-medium text-gink-80"> · {it.portion}</span>
            ) : !it.addons && it.detail ? (
              <span className="text-[12.5px] text-gink-64"> · {it.detail}</span>
            ) : null}
            {it.addons?.map((addon) => (
              <span
                key={addon}
                data-addon=""
                className="ml-1.5 inline-block rounded-[6px] border border-hair bg-paper-deep px-1.5 py-[2px] text-[11.5px] font-medium whitespace-nowrap text-gink-64"
              >
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
export function Kitchen({
  data,
  outlet,
  signOut,
}: {
  data?: KitchenScreenData | null;
  outlet?: OutletBar | null;
  /** Off when the trial or subscription gate has closed the workspace. */
  signOut?: boolean;
}) {
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
  /**
   * The demo board's own memory.
   *
   * With no database there is nothing to write to, and the buttons used to
   * answer with an error on every tap -- a control that looks like the real
   * thing and does nothing is worse than no control at all, because it teaches
   * whoever is trying the product that the buttons are broken. The sample
   * board therefore behaves: a tap moves the sample ticket in this browser and
   * nowhere else, and the header keeps saying the board is local only.
   */
  const [demoState, setDemoState] = useState<Record<string, PrepState>>({});
  const [demoCancelled, setDemoCancelled] = useState<string[]>([]);
  /** Which column a phone is looking at. Ignored on a wall tablet. */
  const [mobileCol, setMobileCol] = useState<'new' | 'preparing' | 'ready'>('new');
  /** Tickets that just appeared, so the card can announce itself. */
  const [arrivals, setArrivals] = useState<string[]>([]);
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
  /** The same chime the voice uses, reachable from the order pass. */
  const chimeRef = useRef<(() => void) | null>(null);
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
    chimeRef.current = chime;
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

      setLog((current) => [{ key, at: clockTimeInZone(null, new Date()), label, text }, ...current].slice(0, LOG_LIMIT));
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

    setLog((current) => [{ key, at: clockTimeInZone(null, new Date()), label, text }, ...current].slice(0, LOG_LIMIT));
    setWaiting(queueRef.current?.pending() ?? 0);
  }, []);

  /* ---------------------------------------------------------------- the board */

  const base: BoardTicket[] = (live
    ? (data?.tickets ?? []).map(fromLive)
    : kitchenOrders.map(fromDemo)
  ).filter((ticket) => {
    if (ticket.orderId) return !cancelled.includes(ticket.orderId);
    return !demoCancelled.includes(ticket.key);
  });

  /**
   * Optimistic overlay. Applied on top of `base`, so a refresh from the server
   * simply wins without any resync bookkeeping.
   *
   * Two sources, one rule: a live ticket's pending state is keyed by its UUID
   * (and disappears with the next server payload), a demo ticket's by its
   * sample id (and simply stays until the page is reloaded).
   */
  const orders = base.map((ticket) =>
    ticket.orderId && pending[ticket.orderId]
      ? { ...ticket, state: pending[ticket.orderId]! }
      : !ticket.orderId && demoState[ticket.key]
        ? { ...ticket, state: demoState[ticket.key] }
        : ticket,
  );

  /* ------------------------------------------------------- arrival highlight */

  /**
   * Cards that appeared since the previous render, for one short animation.
   *
   * The signature is the key list, not the array: `orders` is rebuilt on every
   * render, so depending on it directly would re-run this effect constantly.
   * The first pass only records what was already on the board -- opening the
   * page should not make the whole queue look brand new.
   */
  const keySignature = orders.map((ticket) => ticket.key).join('\n');
  const seenKeysRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const keys = keySignature ? keySignature.split('\n') : [];

    // First pass: remember what is already there and animate nothing. Opening
    // the board must not make a quiet queue look like it just caught fire.
    if (seenKeysRef.current === null) {
      seenKeysRef.current = new Set(keys);
      return;
    }

    const fresh = keys.filter((key) => !seenKeysRef.current!.has(key));
    for (const key of keys) seenKeysRef.current.add(key);
    if (fresh.length === 0) return;

    setArrivals(fresh);
    const timer = setTimeout(() => setArrivals([]), 1400);
    return () => clearTimeout(timer);
  }, [keySignature]);

  /* ------------------------------------------------------ one-tap on a phone */

  /**
   * A phone shows one column at a time (three stacked columns means scrolling
   * past an entire empty queue to reach the food). When the opened column is
   * empty and another one is not, follow the work rather than showing a blank
   * screen -- but only once, so a deliberate choice is never overridden.
   */
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (autoPickedRef.current || orders.length === 0) return;
    autoPickedRef.current = true;
    const hasNew = orders.some((ticket) => ticket.state === 'new');
    if (!hasNew && orders.some((ticket) => ticket.state === 'preparing')) {
      setMobileCol('preparing');
    }
  }, [orders]);

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

    /**
     * No Hindi voice, but the sound is on: the room still has to hear that a
     * ticket landed. A board that fails silently is the one failure a kitchen
     * cannot notice -- the screen looks fine, the food does not get cooked.
     *
     * One chime for the batch, not one per ticket: four orders in the same
     * second is one arrival, and four tones in a row is noise.
     *
     * Not when the device is deliberately muted -- silence there is a choice
     * somebody made, and the missed list still records the ticket.
     */
    if (audioRef.current && !readyToSpeak) {
      try {
        chimeRef.current?.();
      } catch {
        /* audio locked until a gesture; the ticket is still listed */
      }
    }

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

  /**
   * Tickets with a write in flight.
   *
   * This board moves a card the instant you tap it -- the optimistic overlay
   * below puts it in the next column before the server has answered -- which is
   * right for a cook watching the board, and is also what made a double tap
   * dangerous: the card lands in "Preparing" with "Mark ready" under the thumb
   * that just tapped, so two quick taps could write two transitions and skip a
   * stage. A ticket that skips "Preparing" is a dish nobody started.
   *
   * A ref rather than state on purpose: it must be read at the moment of the
   * tap, not on the render that the tap itself triggers.
   */
  const advancingRef = useRef<Set<string>>(new Set());

  const advance = async (ticket: BoardTicket) => {
    const next = nextPrepState(ticket.state);
    if (!next) return;

    const lockKey = ticket.orderId ?? ticket.key;
    if (advancingRef.current.has(lockKey)) return;
    advancingRef.current.add(lockKey);
    try {
      await advanceOnce(ticket, next);
    } finally {
      advancingRef.current.delete(lockKey);
    }
  };

  const advanceOnce = async (ticket: BoardTicket, next: PrepState) => {
    // The sample board keeps its own books. See demoState above: the alternative
    // is a button that errors, which reads as a broken product.
    if (!ticket.orderId) {
      setError('');
      setDemoState((current) => ({ ...current, [ticket.key]: next }));
      speak(`demo:${ticket.key}:${next}`, advanceText(ticket.table, next), ticket.table, 'info');
      return;
    }

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
    // Demo tickets have no UUID, so their own key stands in for one: the
    // confirm step has to be able to tell two sample tickets apart.
    const ticketKey = ticket.orderId ?? ticket.key;

    if (confirmCancel !== ticketKey) {
      setConfirmCancel(ticketKey);
      setError('');
      return;
    }

    if (!ticket.orderId) {
      setConfirmCancel(null);
      setDemoCancelled((current) => [...current, ticket.key]);
      speak(`demo-cancel:${ticket.key}`, cancelText(ticket.table), `${ticket.table} · cancelled`, 'order');
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

  /**
   * Whether this board may offer a control that writes.
   *
   * The sample board is always interactive -- it writes to nothing but this
   * browser. A live board is interactive only when the server said the caller
   * can write, which is the same question the database will ask.
   */
  const interactive = !live || Boolean(data?.canAdvance);

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
    /*
     * THE SAME SHELL AS EVERY OTHER STAFF SCREEN
     *
     * This board used to be a full-screen wall display with no navigation: its
     * own header, its own frame, and one link back to the dashboard as the only
     * way out. That was a deliberate decision, and it was wrong for how the
     * product is actually used -- a manager moves between the floor, the
     * counter and the board all shift, and every trip to Kitchen dropped the
     * rail, the venue and the way back.
     *
     * It is now an OwnerPage like the other nine screens. The rail, the top
     * bar, the outlet switcher and sign-out are the shared ones, `active`
     * marks Kitchen in it, and navigation to and from it is ordinary client
     * navigation -- no reload, and the URL still works on a refresh.
     *
     * The board keeps its own density: a wider column, the ticket grid, and the
     * audio controls as this page's actions rather than chrome above the shell.
     */
    <OwnerPage active="kitchen" outlet={outlet} signOut={signOut} wide>
      <PageHead
        kicker={live ? 'Kitchen · live board' : 'Kitchen · demo mode'}
        title={live ? data?.restaurantName || 'Kitchen' : restaurant.name}
        meta={
          live
            ? 'Tickets arrive the moment a guest confirms. Nothing here is cached.'
            : 'A rehearsal board: nothing here reaches a kitchen.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Delivery is a status, so it is a tag. It was a hand-made pill
                with its own 8px step, which made the head of this screen the
                only place in the product using that height. */}
            <Tag tone={live ? (delivery === 'live' ? 'live' : 'neutral') : 'neutral'}>
              <Dot tone={live && delivery === 'live' ? 'live' : 'idle'} />
              {live
                ? delivery === 'live'
                  ? 'Live · instant'
                  : delivery === 'connecting'
                    ? 'Live · connecting…'
                    : 'Live · checking every 5s'
                : 'Demo board · local only'}
            </Tag>
            {waiting > 0 && <Tag tone="work">{waiting} waiting</Tag>}
          </div>
        }
      />

      {/*
       * THE SOUND DESK
       *
       * Everything about the voice lives in one band directly under the title,
       * because it is one job: is it on, which voice, how fast, and can I hear
       * it. In the old full-screen header these controls were mixed in with
       * navigation and the delivery pill, which made the one thing a cook
       * actually adjusts at 9pm the hardest thing to find.
       *
       * They are controls, not settings: each writes only to this screen --
       * speed and voice to the speech engine, mute to this device -- and none
       * of them touches an order.
       */}
      <section aria-label="Announcements" className="mb-3 overflow-hidden rounded-[18px] border border-hair bg-card">
        {/* THE SOUND DESK
            Everything about the voice lives in one card, because it is one job:
            is it on, which voice, how fast, and can I hear it. It used to be a
            flat band of eight pills of five different shapes and two of its own
            heights, so the one thing a cook adjusts at 9pm was also the least
            legible thing on the screen. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hair px-4 py-2.5">
          <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-gink">Sound</h2>
          <span className="text-[11.5px] text-gink-46">
            Orders are read out in Hindi, one sentence at a time.
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Tag tone={voiceState === 'ready' ? 'live' : 'due'}>
              {voiceState === 'starting'
                ? 'हिंदी · आवाज़ खोज रहे हैं'
                : voiceState === 'ready'
                  ? 'हिंदी · तैयार'
                  : 'हिंदी · आवाज़ नहीं'}
            </Tag>
            {live && (
              <Tag tone={speaksHere ? 'neutral' : 'due'}>
                {speaksHere ? 'This screen speaks' : 'Screen muted'}
              </Tag>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {/* One control, not a pill with a link inside it. The state is the
              button: pressing it is the only thing you can do to it. */}
          <button
            type="button"
            aria-pressed={audio}
            onClick={() => setAudio((value) => !value)}
            title={audio ? 'Turn the announcements off on this screen' : 'Turn the announcements on'}
            className={[
              'inline-flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-[12.5px] font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]',
              audio
                ? 'border-[color-mix(in_oklab,var(--p-accent)_45%,transparent)] bg-accent-soft text-gink'
                : 'border-hair-strong bg-card text-gink-64 hover:border-gink-28 hover:text-gink',
            ].join(' ')}
          >
            <SwitchTrack on={audio} />
            Kitchen audio {audio ? 'on' : 'off'}
          </button>

          {/* Speed. A hurried Hindi voice is what sounds slurred, so the
              operator gets the last word on pace instead of a constant. */}
          <Segmented
            label="आवाज़ की रफ़्तार — voice speed"
            size="sm"
            value={speed}
            onChange={(next) => {
              setSpeed(next);
              speedRef.current = next;
              speechRef.current?.setRateScale(SPEEDS[next]);
            }}
            options={[
              { value: 'slow', label: 'धीमा' },
              { value: 'normal', label: 'सामान्य' },
              { value: 'fast', label: 'तेज़' },
            ]}
          />

          {/* Which Hindi voice. A device can carry two, and they are not
              equally good -- an embedded engine and a downloaded neural one
              both answer to hi-IN. Only shown when there is a real choice. */}
          {voiceList.length > 1 && (
            <select
              aria-label="Hindi voice"
              value={voicePref}
              onChange={(event) => {
                const next = event.target.value;
                setVoicePref(next);
                speechRef.current?.setVoiceName(next || null);
                setVoiceName(speechRef.current?.voiceName() ?? null);
              }}
              className="h-9 max-w-[190px] rounded-[10px] border border-hair-strong bg-card px-2.5 pr-7 text-[12.5px] text-gink transition-colors hover:border-gink-28 focus:border-[var(--p-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--p-accent)_16%,transparent)] focus:outline-none"
            >
              <option value="">सबसे अच्छी आवाज़ (auto)</option>
              {voiceList.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                </option>
              ))}
            </select>
          )}

          <span className="mx-0.5 hidden h-5 w-px bg-hair sm:block" aria-hidden="true" />

          {live && (
            <button
              type="button"
              aria-pressed={speaksHere}
              onClick={() => setSpeaksHere((value) => !value)}
              title="Turn this off on a second screen in the same kitchen, so orders are not read out twice"
              className={[
                'h-9 rounded-[10px] border px-3 text-[12.5px] font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]',
                speaksHere
                  ? 'border-[color-mix(in_oklab,var(--p-accent)_45%,transparent)] bg-accent-soft text-gink'
                  : 'border-hair-strong bg-card text-gink-64 hover:border-gink-28 hover:text-gink',
              ].join(' ')}
            >
              {speaksHere ? 'This screen speaks' : 'Screen muted'}
            </button>
          )}

          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => replay(`test:${Date.now()}`, sampleText, 'Test')}
              className={btn('ghost', 'sm')}
            >
              Test announcement
            </button>
            <button
              type="button"
              disabled={!latest}
              onClick={() => {
                if (!latest) return;
                replay(
                  `new:${latest.orderId ?? latest.key}`,
                  orderAnnouncement(latest),
                  announceLogLabel(latest.table, latest.items),
                );
              }}
              className={btn('quiet', 'sm')}
            >
              Replay latest
            </button>
          </span>
        </div>
      </section>

        {/* ----------------------------------------------------- the one banner */}

      <div className="flex flex-col gap-2">
        {/* The sample board behaves. Saying so is what stops a tap from
            looking like it did nothing: the ticket moves, and only this
            browser knows. */}
        {!live && (
          <Notice
            role="note"
            className="mb-0"
            label={<strong className="text-[12.5px] font-semibold text-gink">Sample board.</strong>}
          >
            These tickets are fictional. A tap moves one here and nowhere else — connect the database
            to run a real service.
          </Notice>
        )}

        {status && (
          <Notice
            role={status.tone === 'alert' ? 'alert' : 'status'}
            tone={status.tone === 'alert' ? 'due' : 'plain'}
            className="mb-0"
            label={<strong className="text-[12.5px] font-semibold text-gink">{status.title}</strong>}
            action={
              status.action ? (
                <button type="button" onClick={status.action.run} className={btn('ghost', 'sm')}>
                  {status.action.label}
                </button>
              ) : undefined
            }
          >
            {status.body}
          </Notice>
        )}

        {missed.length > 0 && (
          <Notice
            role="status"
            tone="accent"
            className="mb-0"
            label={
              <strong className="text-[12.5px] font-semibold text-gink">
                {missed.length} order{missed.length === 1 ? '' : 's'} {missed.length === 1 ? 'has' : 'have'} not
                been read out.
              </strong>
            }
            action={
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={readMissed} className={btn('solid', 'sm')}>
                  Read them out
                </button>
                <button type="button" onClick={() => setMissed([])} className={btn('quiet', 'sm')}>
                  Dismiss
                </button>
              </span>
            }
          >
            {/* Two honest reasons, and they are not the same thing. */}
            {missedReason === 'muted'
              ? 'They arrived while this screen was muted or the sound was off.'
              : voiceState === 'ready'
                ? 'They were placed before this board was opened. The pass may have seen them already.'
                : 'They arrived while this device had no voice to read them with.'}{' '}
            They are on the board below.
          </Notice>
        )}

        {log.length > 0 && (
          <div aria-label="Recent announcements">
            <Panel
              /* "Spoken" would be a lie while muted: the entries are what the
                 board WOULD have read out. The text is the exact string handed
                 to the voice, Devanagari and all -- so the owner can read what
                 the kitchen will hear. */
              title="Announcements"
              meta={
                audio && speaksHere
                  ? voiceState === 'ready'
                    ? `हिंदी · ${voiceName ?? 'voice'}`
                    : 'हिंदी · no voice on this device'
                  : 'muted on this screen — nothing was read aloud'
              }
              bodyClassName=""
            >
            <ul className="divide-y divide-hair">
              {log.map((entry) => (
                <li key={`${entry.key}-${entry.at}`} className="flex items-baseline gap-2.5 px-3.5 py-1.5 text-[12.5px]">
                  <span className="tnum shrink-0 text-gink-46">{entry.at}</span>
                  <span className="shrink-0 font-medium text-gink-64">{entry.label}</span>
                  <span className="min-w-0 flex-1 truncate text-gink">{entry.text}</span>
                  <button
                    type="button"
                    aria-label={`Replay ${entry.label}`}
                    onClick={() => replay(`${entry.key}:replay:${entry.at}`, entry.text, entry.label)}
                    className="shrink-0 text-[11.5px] font-medium text-gink-64 underline underline-offset-2 hover:text-gink"
                  >
                    Replay
                  </button>
                </li>
              ))}
            </ul>
            </Panel>
          </div>
        )}

        {announcement && (
          <p role="status" className="text-[12.5px] text-gink-46">
            {/* "Last announcement" was a half-truth: it was the last thing the
                queue ACCEPTED, which in a burst is not the thing being said. */}
            {speaking ? 'Speaking now' : 'Last announcement'}: {announcement}
          </p>
        )}

        {error && (
          <Notice
            role="alert"
            tone="due"
            className="mb-0"
            label={
              <strong className="text-[12.5px] font-semibold text-gink">
                Could not update the ticket.
              </strong>
            }
          >
            {error}
          </Notice>
        )}

        {data?.blocked && <SignInPrompt reason={data.blocked} screen="kitchen board" />}

        {/* -------------------------------------------------- why nothing moves */}

        {/* One banner, naming the actual obstacle. The buttons below are not
            rendered in this state, so this is the only explanation on screen. */}
        {live && data && !data.blocked && !data.canAdvance && (
          <Notice
            role="status"
            tone={data.cannotAdvance === 'plan' ? 'due' : 'plain'}
            className="mb-0"
            label={
              <strong className="text-[12.5px] font-semibold text-gink">
                {data.cannotAdvance === 'plan'
                  ? 'Read-only: the server is refusing writes for this restaurant.'
                  : 'You can watch this board, but not move tickets.'}
              </strong>
            }
          >
            {data.cannotAdvance === 'plan'
              ? 'Its plan or trial period is not currently active. Menus, orders and reports stay readable, and tickets start moving again the moment access is restored — nothing has been deleted.'
              : `A ${data.role ?? 'member'} can see the kitchen board; moving a ticket needs an owner, a manager or kitchen staff. Ask one of them to take a screen.`}
          </Notice>
        )}

        {live && data && !data.blocked && data.tickets.length === 0 && (
          <Empty className="mb-0">
            No open tickets in the last few hours. Orders placed from the customer menu appear here
            the moment the guest confirms.
          </Empty>
        )}
      </div>

      {/* ----------------------------------------------------- phone columns */}

      {/* Hidden above 900px, where all three columns are on screen at once.
          Counts live in the tabs so an empty column can be skipped without
          opening it -- on a phone, the queue you cannot see still has to be
          legible. */}
      {/* On a phone the board shows one column at a time; the three pills are
          the whole of that navigation, so they stretch to the width of the
          screen instead of huddling at the left edge where a thumb has to aim
          at 90px. The count is in the label, because "New 3" is the reason to
          tap it. */}
      <Segmented
        label="Ticket columns"
        className="mt-3 lg:hidden"
        fill
        value={mobileCol}
        onChange={(next) => setMobileCol(next as typeof mobileCol)}
        options={cols.map((c) => ({
          value: c.key,
          label: (
            <>
              {c.title}
              <span className="tnum text-[11.5px] opacity-70">{c.orders.length}</span>
            </>
          ),
        }))}
      />

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {cols.map((c) => (
          <section
            key={c.key}
            aria-label={c.title}
            className={[
              'min-w-0',
              /* On a phone only the chosen column is shown. Above 900px all
                 three are, side by side, because a cook reads the queue by
                 shape rather than by tapping. */
              mobileCol === c.key ? 'block' : 'hidden lg:block',
            ].join(' ')}
          >
            {/* A column is a stage, so its head says which stage in colour as
                well as in words: copper is waiting to start, ink is in hand,
                green is ready to leave. The count is a tag because it is the
                one number the head carries. */}
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-hair pb-2">
              <h2 className="flex items-center gap-2 text-[12.5px] font-semibold tracking-[-0.005em] text-gink">
                <span
                  aria-hidden="true"
                  className={[
                    'size-1.5 rounded-full',
                    c.key === 'new'
                      ? 'bg-[var(--p-accent)]'
                      : c.key === 'preparing'
                        ? 'bg-gink'
                        : 'bg-[var(--p-live)]',
                  ].join(' ')}
                />
                {c.title}
              </h2>
              <Tag tone="neutral">{c.orders.length}</Tag>
            </div>

            <div className="grid gap-2">
              {c.orders.map((o) => (
                <article
                  key={o.key}
                  data-state={o.state}
                  data-arriving={arrivals.includes(o.key) ? 'true' : undefined}
                  className={[
                    'relative overflow-hidden rounded-[14px] border bg-card p-3',
                    /* Served tickets stay on the board until the pass clears
                       them, so they fade rather than disappear: a card that
                       vanishes has no history. */
                    o.state === 'served' ? 'border-hair opacity-55' : 'border-hair-strong',
                    arrivals.includes(o.key) ? 'animate-[kbrise_320ms_cubic-bezier(0.22,1,0.36,1)]' : '',
                  ].join(' ')}
                >
                  {/* One 3px edge in the stage's colour. A board is read from
                      a metre and a half away, and this is what makes a column
                      a column rather than a stack of identical cards. */}
                  <span
                    aria-hidden="true"
                    data-stage-edge={o.state}
                    className={[
                      'absolute inset-y-0 left-0 w-[3px]',
                      o.state === 'new'
                        ? 'bg-[var(--p-accent)]'
                        : o.state === 'preparing'
                          ? 'bg-gink'
                          : o.state === 'ready'
                            ? 'bg-[var(--p-live)]'
                            : 'bg-gink-28',
                    ].join(' ')}
                  />
                  <div className="flex items-center gap-2">
                    <span className="tnum text-[15px] font-semibold tracking-[-0.01em] text-gink">{o.code}</span>
                    <span className="rounded-[6px] bg-paper-deep px-1.5 py-0.5 text-[11.5px] font-semibold tracking-[0.04em] text-gink-80">
                      {o.table}
                    </span>
                    {/* Age is the one number a cook acts on without reading
                        anything else, so it is the loudest thing on the row --
                        inside the geometry every other status uses. */}
                    <span
                      className={[
                        'tnum ml-auto rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold tracking-[0.01em]',
                        o.ageMin >= LATE_AFTER_MIN
                          ? 'bg-[color-mix(in_oklab,var(--p-due)_10%,white)] text-[var(--p-due)]'
                          : o.ageMin >= WARN_AFTER_MIN
                            ? 'bg-paper-deep text-gink-64'
                            : 'bg-accent-soft text-[var(--p-accent)]',
                      ].join(' ')}
                    >
                      {o.ageMin} min
                    </span>
                  </div>

                  {o.payment === 'pending' && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-[7px] bg-[color-mix(in_oklab,var(--p-due)_8%,white)] px-2 py-1 text-[11.5px] font-medium text-[var(--p-due)]">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--p-due)]" />
                      Unpaid · pay at counter
                    </div>
                  )}

                  <Items order={o} compact={o.state === 'served'} />

                  {o.note && (
                    <div className="mt-2 border-l-2 border-gink-28 pl-2.5 text-[12.5px] leading-[1.45] text-gink-64 italic">
                      “{o.note}”
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hair pt-2.5">
                    <span className="mr-auto text-[13px] font-semibold text-gink">
                      <Money value={rupeesToPaise(o.total)} strong />
                    </span>

                    {interactive && o.state === 'new' && (
                      <button type="button" className={kbBtn('solid')} onClick={() => advance(o)}>
                        Start preparing
                      </button>
                    )}
                    {interactive && o.state === 'preparing' && (
                      <button type="button" className={kbBtn('solid')} onClick={() => advance(o)}>
                        Mark ready
                      </button>
                    )}
                    {interactive && o.state === 'ready' && (
                      <button type="button" className={kbBtn('solid')} onClick={() => advance(o)}>
                        Mark served
                      </button>
                    )}
                    {o.state === 'served' && (
                      <span aria-label="Order served" className="text-[11.5px] font-medium text-gink-46">
                        Served
                      </span>
                    )}

                    {/* An icon, not an emoji. The emoji renders as whatever
                        the device's font decides -- colour, weight and size all
                        vary -- on the one control a cook may hunt for by shape. */}
                    <button
                      type="button"
                      title="Replay voice announcement"
                      aria-label={`Replay order ${o.code}`}
                      onClick={() =>
                        replay(
                          `new:${o.orderId ?? o.key}`,
                          orderAnnouncement(o),
                          announceLogLabel(o.table, o.items),
                        )
                      }
                      className={`${btn('ghost', 'sm')} w-9 px-0`}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                      >
                        <path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4z" strokeLinejoin="round" />
                        <path d="M15.6 9.2a4 4 0 0 1 0 5.6" strokeLinecap="round" />
                        <path d="M17.9 6.9a7.2 7.2 0 0 1 0 10.2" strokeLinecap="round" />
                      </svg>
                    </button>

                    {interactive && o.state !== 'served' ? (
                      confirmCancel === (o.orderId ?? o.key) ? (
                        <>
                          <button
                            type="button"
                            disabled={Boolean(o.orderId) && cancelBusy === o.orderId}
                            onClick={() => cancelTicket(o)}
                            className={kbBtn('danger')}
                          >
                            {o.orderId && cancelBusy === o.orderId ? 'Cancelling…' : 'Yes, cancel'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmCancel(null)}
                            className={kbBtn('quiet')}
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Cancel order for ${o.table}`}
                          onClick={() => cancelTicket(o)}
                          className={kbBtn('quiet')}
                        >
                          Cancel
                        </button>
                      )
                    ) : null}
                  </div>
                </article>
              ))}

              {c.orders.length === 0 && (
                <Empty className="min-h-[76px] py-5">Nothing here</Empty>
              )}
            </div>
          </section>
        ))}
      </div>
    </OwnerPage>
  );
}

/**
 * The board's own buttons.
 *
 * The comment here used to say "44px targets", and the code drew 36px pills --
 * which is exactly the kind of drift a comment cannot catch. So: the one tap
 * that moves a ticket is `md` (44px), because this screen is read from a metre
 * and a half away and often tapped with wet hands; everything around it is
 * `sm`, the same 36px action the rest of the product uses. No pills: an action
 * is a rectangle, and a pill means "status" everywhere else in this product.
 */
function kbBtn(tone: 'solid' | 'quiet' | 'danger'): string {
  if (tone === 'solid') return btn('solid', 'md');
  if (tone === 'danger') return btn('danger', 'sm');
  return btn('quiet', 'sm');
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
