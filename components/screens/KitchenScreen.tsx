'use client';

import { rupeesToPaise } from '@/lib/money';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { CancelledTicket, KitchenScreenData, KitchenTicket } from '@/lib/db/kitchen-screen';
import { claimKitchenSpeaker, type KitchenSpeakerState } from '@/lib/kitchen-speaker-lock';
import { readMissedOrderIds, writeMissedOrderIds } from '@/lib/kitchen-missed';
import { clockTimeInZone } from '@/lib/db/time';
import { confirmedPrepChange, LATE_AFTER_MIN, WARN_AFTER_MIN, nextPrepState, type PrepState } from '@/lib/db/prep';
import { advanceOrderAction } from '@/app/(staff)/kitchen/actions';
import { HeldTableStrip } from '@/components/owner/HeldTableStrip';
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
  type EnqueueResult,
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
const MISSED_LIMIT = 100;

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
function kitchenStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

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

type LogEntry = { key: string; at: string; label: string; text: string; status: 'queued' | 'completed' | 'failed' | 'cancelled' };

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
            {/* min-w-0 and shrink-0 are load-bearing, not cosmetic: a flex item
                refuses to go narrower than its longest word by default, so a
                long dish name used to run past the card and get clipped by the
                card's own overflow-hidden. The mark keeps its size; the name
                wraps. */}
            <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
              <span className="shrink-0">
                <VegMark veg={it.veg} size={11} />
              </span>
              <span className="min-w-0 font-medium">{it.name}</span>
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
                className="ml-1.5 inline-block max-w-full rounded-[var(--p-r-chip)] border border-hair bg-paper-deep px-1.5 py-[2px] text-[11.5px] leading-[1.4] font-medium whitespace-nowrap text-gink-64 max-lg:whitespace-normal"
              >
                {/* nowrap keeps a two-word modifier on one line where there is
                    room; below lg it wraps instead of being clipped, because a
                    half-visible "Extra che…" is a modifier the cook cannot
                    read, and this card clips. */}
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
     pacing     short phrases and explicit pauses; voice character remains device-dependent
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
  const [voiceList, setVoiceList] = useState<{ name: string; lang: string; localService?: boolean; default?: boolean }[]>([]);
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
  /**
   * Where the ticket went, and where focus goes with it.
   *
   * Pressing "Start preparing" removes the card from the column the finger is
   * in -- on a phone the whole card leaves the screen, because only the chosen
   * column is drawn. A keyboard user was therefore left with focus on a node
   * that no longer existed, which silently resets it to the top of the
   * document: the next Tab press starts at the rail instead of at the queue.
   *
   * So the board says where the ticket went, in one line, and that line takes
   * focus. It is above the columns on every width, so focusing it can never
   * land on a hidden node, and Tab from it reaches the column pills and then
   * the cards.
   */
  const movedRef = useRef<HTMLParagraphElement | null>(null);
  const [moved, setMoved] = useState('');
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
  const missedRef = useRef<BoardTicket[]>([]);
  const [speakerState, setSpeakerState] = useState<KitchenSpeakerState>('claiming');
  /**
   * Why those tickets were not read out.
   *
   * Two different situations that used to share one sentence: this device
   * cannot speak at all (no Hindi voice), or the operator muted this screen.
   * The first needs a fix and the second needs a decision, so the banner says
   * which one it is.
   */
  const [missedReason, setMissedReason] = useState<'voice' | 'muted' | 'speaker' | 'queue'>('voice');
  const [speechWarning, setSpeechWarning] = useState('');
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
  const speakerAllowedRef = useRef(false);
  const announcementTicketsRef = useRef(new Map<string, BoardTicket>());
  const missedAttemptByOrderRef = useRef(new Map<string, string>());
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  /** Cancellations already announced, so a refresh cannot repeat one. */
  const cancelSeenRef = useRef<Set<string>>(new Set());
  const cancelPrimedRef = useRef(false);
  const activeRestaurantRef = useRef<string | null | undefined>(undefined);
  /** True once the board knows whether a Hindi voice exists. */
  const settledRef = useRef(false);
  /** The same answer, readable from the announcement pass without a re-render. */
  const canAnnounceRef = useRef(false);
  const [settled, setSettled] = useState(false);

  const changeMissed = useCallback((update: (current: BoardTicket[]) => BoardTicket[]) => {
    setMissed((current) => {
      const next = update(current);
      missedRef.current = next;
      writeMissedOrderIds(kitchenStorage(), restaurantId, next.flatMap((ticket) => ticket.orderId ? [ticket.orderId] : []));
      return next;
    });
  }, [restaurantId]);

  /* ------------------------------------------- same-browser speaker election */

  useEffect(() => {
    if (!live) {
      speakerAllowedRef.current = true;
      setSpeakerState('inactive');
      return;
    }
    if (!restaurantId || !speaksHere) {
      speakerAllowedRef.current = false;
      setSpeakerState('inactive');
      return;
    }

    const locks = typeof navigator !== 'undefined' && 'locks' in navigator
      ? navigator.locks
      : null;
    return claimKitchenSpeaker(locks, restaurantId, (state) => {
      speakerAllowedRef.current = state === 'leader' || state === 'local-only';
      setSpeakerState(state);
    });
  }, [live, restaurantId, speaksHere]);

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
    if (activeRestaurantRef.current !== restaurantId) {
      activeRestaurantRef.current = restaurantId;
      seenRef.current = new Set();
      primedRef.current = false;
      cancelSeenRef.current.clear();
      cancelPrimedRef.current = false;
      missedRef.current = [];
      missedAttemptByOrderRef.current.clear();
      announcementTicketsRef.current.clear();
      setMissed([]);
      setLog([]);
      setAnnouncement('');
      setMissedReason('voice');
      setSpeechWarning('');
      setSpeaking(false);
      setWaiting(0);
      setVoiceName(null);
      setVoiceList([]);
      setLostCount(0);
      setStalled(false);
      setPending({});
      setCancelled([]);
      setConfirmCancel(null);
      setCancelBusy(null);
      setError('');
      setArrivals([]);
      setMobileCol('new');
      canAnnounceRef.current = false;
      settledRef.current = false;
      setSettled(false);
      setVoiceState('starting');
    }

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

      // A saved preference may not exist on this browser. Clear it only after
      // at least one Hindi candidate is discovered, then report the automatic
      // selection rather than implying the stale preference is still active.
      let stored = '';
      try { stored = localStorage.getItem(VOICE_KEY) ?? ''; } catch { /* storage is optional */ }
      const hindiVoices = engine.hindiVoices();
      if (stored && hindiVoices.length > 0 && !engine.setVoiceName(stored)) {
        // Only call a saved voice stale once the browser has discovered at
        // least one Hindi voice; an initially empty list is still loading.
        try { localStorage.removeItem(VOICE_KEY); } catch { /* storage is optional */ }
        setVoicePref('');
        engine.setVoiceName(null);
      } else if (stored && hindiVoices.length > 0) {
        engine.setVoiceName(stored);
      }

      setVoiceList(hindiVoices.map((v) => ({
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        default: v.default,
      })));

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
          if (!current || !audioRef.current || !speaksRef.current || !speakerAllowedRef.current) {
            onEnd({ status: 'failed', reason: 'This screen is muted or another tab owns the speaker', completedSegments: 0, totalSegments: 1 });
            return;
          }
          if (!current.available()) {
            onEnd({ status: 'failed', reason: 'No Hindi voice is available', completedSegments: 0, totalSegments: 1 });
            return;
          }
          current.speak(text, onEnd);
        },
      },
      {
        onBegin(entry) {
          setAnnouncement(entry.text);
          setSpeaking(true);
          setWaiting(queueRef.current?.pending() ?? 0);
        },
        onResult(entry, outcome) {
          const associatedTicket = announcementTicketsRef.current.get(entry.key);
          if (associatedTicket?.orderId && missedAttemptByOrderRef.current.get(associatedTicket.orderId) === entry.key) {
            missedAttemptByOrderRef.current.delete(associatedTicket.orderId);
          }
          setLog((current) => current.map((row) => row.key === entry.key
            ? { ...row, status: outcome.status === 'completed' ? 'completed' : outcome.status === 'failed' ? 'failed' : 'cancelled' }
            : row));
          if (outcome.status === 'completed') {
            const ticket = announcementTicketsRef.current.get(entry.key);
            if (ticket?.orderId) changeMissed((current) => current.filter((item) => item.orderId !== ticket.orderId));
          } else if (outcome.status === 'failed') {
            setLostCount((count) => count + 1);
            const ticket = announcementTicketsRef.current.get(entry.key);
            if (ticket?.orderId && entry.key.startsWith('new:')) {
              setMissedReason(outcome.reason.includes('speaker') ? 'speaker' : outcome.reason.includes('muted') ? 'muted' : 'voice');
              changeMissed((current) => current.some((item) => item.orderId === ticket.orderId)
                ? current
                : [ticket, ...current].slice(0, MISSED_LIMIT));
            }
            if (speechRef.current?.stalled()) setStalled(true);
          }
          announcementTicketsRef.current.delete(entry.key);
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
      queueRef.current?.dispose();
      engine.cancel();
      speechRef.current = null;
      queueRef.current = null;
    };
  }, [restaurantId, changeMissed]);

  const speak = useCallback(
    (key: string, text: string, label: string, priority: 'order' | 'info' = 'order'): EnqueueResult => {
      setLog((current) => [{ key, at: clockTimeInZone(null, new Date()), label, text, status: 'queued' as const }, ...current].slice(0, LOG_LIMIT));
      const result = queueRef.current?.push(key, text, priority) ?? 'full';
      if (result !== 'queued') setLog((current) => current.filter((row) => row.key !== key));
      if (result === 'full') setSpeechWarning('Speech queue is full. Tickets remain visible; replay when the queue clears.');
      setWaiting(queueRef.current?.pending() ?? 0);
      return result;
    },
    [],
  );

  /**
   * Replay one, on demand, whether or not it has been said before.
   *
   * force(), not push(): a replay pressed while the original is still waiting
   * would otherwise be refused as a duplicate and appear to do nothing.
   */
  const replay = useCallback((key: string, text: string, label: string): EnqueueResult => {
    setLog((current) => [{ key, at: clockTimeInZone(null, new Date()), label, text, status: 'queued' as const }, ...current].slice(0, LOG_LIMIT));
    const result = queueRef.current?.force(key, text, 'order') ?? 'full';
    if (result !== 'queued') setLog((current) => current.filter((row) => row.key !== key));
    if (result === 'full') setSpeechWarning('Speech queue is full. Tickets remain visible; replay when the queue clears.');
    setWaiting(queueRef.current?.pending() ?? 0);
    return result;
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
  const autoPickedRef = useRef(false);

  useEffect(() => {
    seenKeysRef.current = null;
    autoPickedRef.current = false;
  }, [restaurantId]);

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
      const savedMissedIds = new Set(readMissedOrderIds(kitchenStorage(), restaurantId));
      const restoredMissed = orders.filter((ticket) => ticket.orderId && savedMissedIds.has(ticket.orderId));
      const combinedMissed = [...offered, ...restoredMissed.filter((ticket) => !offered.some((row) => row.orderId === ticket.orderId))];
      missedRef.current = combinedMissed;
      setMissed(combinedMissed);
      writeMissedOrderIds(kitchenStorage(), restaurantId, combinedMissed.flatMap((ticket) => ticket.orderId ? [ticket.orderId] : []));
      return;
    }

    const fresh = selectNewTickets(orders, seenRef.current);
    if (fresh.length === 0) return;

    // Nothing is spent until both the Hindi voice and same-origin speaker
    // election have settled. A newly opened tab must not race the active one.
    if (!settled || (live && speakerState === 'claiming')) return;

    const readyToSpeak = canAnnounceRef.current;
    const canSpeak = audioRef.current && speaksRef.current && readyToSpeak && speakerAllowedRef.current;

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
        // Unheard, and never pretended otherwise. Persist the order ID so a
        // refresh can restore its recovery entry while the server still returns it.
        seenRef.current.add(ticket.orderId);
        setMissedReason(!readyToSpeak ? 'voice' : !speakerAllowedRef.current ? 'speaker' : 'muted');
        changeMissed((current) => current.some((item) => item.orderId === ticket.orderId)
          ? current
          : [ticket, ...current].slice(0, MISSED_LIMIT));
        continue;
      }

      const key = `new:${ticket.orderId}`;
      announcementTicketsRef.current.set(key, ticket);
      missedAttemptByOrderRef.current.set(ticket.orderId, key);
      // Persist as needing confirmation before the asynchronous utterance can
      // begin. A refresh/interruption then restores a replay path.
      changeMissed((current) => current.some((item) => item.orderId === ticket.orderId)
        ? current
        : [ticket, ...current].slice(0, MISSED_LIMIT));
      const result = speak(key, orderAnnouncement(ticket), announceLogLabel(ticket.table, ticket.items), 'order');
      if (result === 'full') setMissedReason('queue');
      if (result !== 'queued') {
        missedAttemptByOrderRef.current.delete(ticket.orderId);
        announcementTicketsRef.current.delete(key);
      }
      // Full/duplicate outcomes remain in the recoverable list; an actual
      // successful onend is the only event that removes it.
      seenRef.current.add(ticket.orderId);
    }

    writeSeen(restaurantId, [...seenRef.current]);

  }, [orders, live, restaurantId, speak, settled, voiceState, speakerState, changeMissed]);

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
        body: 'This device is muted. The browser can coordinate tabs in this profile only; mute other devices manually, because cross-device duplicate audio cannot be prevented here.',
        action: { label: 'Speak here too', run: () => setSpeaksHere(true) },
      };
    }

    if (live && speakerState === 'busy') {
      return { tone: 'quiet', title: 'Another tab owns this kitchen speaker.', body: 'This tab will not speak duplicate tickets. Orders remain visible here; the owner tab should be the one with sound enabled.' };
    }

    if (live && speakerState === 'local-only') {
      return { tone: 'quiet', title: 'This browser cannot coordinate kitchen tabs.', body: 'Keep only one kitchen tab open on this browser. Speaker coordination is browser-local and does not guarantee exactly-once audio across devices.' };
    }

    if (lostCount > 0) {
      return {
        tone: 'alert',
        title: `${lostCount} announcement${lostCount === 1 ? '' : 's'} did not complete.`,
        body: stalled
          ? 'The browser timed out waiting for Hindi speech. Tap the board once, press “Test announcement”, then replay anything from the list below.'
          : 'The browser reported an audio error or interruption. Check the voice and sound controls, then replay anything from the list below.',
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
  }, [audio, live, speaksHere, stalled, lostCount, voiceState, gestureDone, speakerState]);

  /**
   * Move focus to the note, after it exists.
   *
   * An effect rather than a call beside setMoved() because the paragraph is
   * rendered conditionally: focusing the previous render's node would do
   * nothing. `preventScroll` is deliberately not passed -- on a phone the note
   * sits above the columns, and scrolling it into view is how the cook learns
   * where the card went.
   */
  useEffect(() => {
    if (!moved) return;
    movedRef.current?.focus();
  }, [moved]);

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
      setMoved(movedLine(ticket, next));
      speak(`demo:${ticket.key}:${next}`, advanceText(ticket.table, next), ticket.table, 'info');
      return;
    }

    setError('');
    setPending((current) => ({ ...current, [ticket.orderId!]: next }));

    const result = await advanceOrderAction(ticket.orderId);

    setPending((current) => {
      const copy = { ...current };
      delete copy[ticket.orderId!];
      return copy;
    });

    if (!result.ok) {
      // The card does not move when the server refuses, so focus must not move
      // either: the error banner is announced, and the button stays under the
      // finger.
      setError(result.error);
      return;
    }
    // The server's own answer, not the guess we drew optimistically. If they
    // disagree the board is already corrected by the overlay above; the note
    // only ever repeats what the database said.
    setMoved(movedLine(ticket, result.state ?? next));
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
    const announcedState = confirmedPrepChange(ticket.state, result);
    if (announcedState) {
      speak(`adv:${ticket.orderId}:${announcedState}`, advanceText(ticket.table, announcedState), ticket.table, 'info');
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
   * Representative sample built with the same formatter as real tickets:
   * table, grouped dishes, and a guest instruction. Its title is exposed on
   * the test button so staff can see the exact phrase being auditioned.
   */
  const sampleText = newOrderText(
    'T5',
    [
      { qty: 2, name: 'Paneer Tikka' },
      { qty: 1, name: 'Butter Naan', detail: 'Half · Extra cheese' },
    ],
    'less spicy',
  );
  const selectedVoiceInfo = voiceList.find((voice) => voice.name === voiceName);

  const readMissed = () => {
    for (const ticket of [...missedRef.current].reverse()) {
      if (!ticket.orderId || missedAttemptByOrderRef.current.has(ticket.orderId)) continue;
      const key = `missed:${ticket.orderId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      announcementTicketsRef.current.set(key, ticket);
      missedAttemptByOrderRef.current.set(ticket.orderId, key);
      const result = replay(key, orderAnnouncement(ticket), announceLogLabel(ticket.table, ticket.items));
      if (result !== 'queued') {
        missedAttemptByOrderRef.current.delete(ticket.orderId);
        announcementTicketsRef.current.delete(key);
      }
    }
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
      <section aria-label="Announcements" className="mb-3 overflow-hidden rounded-[var(--p-r-card)] border border-hair bg-card">
        {/* THE SOUND DESK
            Everything about the voice lives in one card, because it is one job:
            is it on, which voice, how fast, and can I hear it. It used to be a
            flat band of eight pills of five different shapes and two of its own
            heights, so the one thing a cook adjusts at 9pm was also the least
            legible thing on the screen. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hair px-4 py-2.5">
          <h2 className="text-[13.5px] font-semibold tracking-[-0.014em] text-gink">Sound</h2>
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
              /* A switch with a box drawn around it is two controls stacked: the
                 platform's outline inside a bordered pill. The row is the
                 control; the switch is its state. */
              'inline-flex h-9 items-center gap-2.5 rounded-full px-2 text-[12.5px] font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]',
              audio ? 'text-gink' : 'text-gink-64 hover:text-gink',
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

          {/* The exact runtime Hindi candidate is shown below, including its
              language tag. Names and language tags identify the browser voice;
              they do not guarantee human-sounding pronunciation. */}
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
              className="h-9 max-w-[190px] rounded-[var(--p-r-control)] border border-hair-strong bg-card px-2.5 pr-7 text-[12.5px] text-gink transition-colors hover:border-gink-28 focus:border-[var(--p-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--p-accent)_16%,transparent)] focus:outline-none"
            >
              <option value="">स्वचालित (पहले hi-IN)</option>
              {voiceList.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name} · {voice.lang}{voice.default ? ' · system default' : ''}
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
                'h-9 rounded-full px-3 text-[12.5px] font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]',
                speaksHere
                  ? 'bg-[color-mix(in_oklab,var(--p-accent)_12%,transparent)] text-gink'
                  : 'text-gink-64 hover:bg-gink-07 hover:text-gink',
              ].join(' ')}
            >
              {speaksHere ? 'This screen speaks' : 'Screen muted'}
            </button>
          )}

          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Test the selected voice with a representative Hindi sample order"
              title={sampleText}
              onClick={() => replay(`test:${Date.now()}`, sampleText, 'Test')}
              className={btn('ghost', 'sm')}
            >
              Test sample order
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

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-hair px-4 py-2 text-[11.5px] text-gink-64">
          <p aria-live="polite">
            Selected Hindi voice:{' '}
            <strong className="font-semibold text-gink">
              {voiceName
                ? `${voiceName}${selectedVoiceInfo ? ` (${selectedVoiceInfo.lang})` : ''}`
                : voiceState === 'starting' ? 'searching…' : 'none available'}
            </strong>
            {selectedVoiceInfo?.default ? ' · browser default' : ''}
            {' · '}
            {voiceName && voicePref === voiceName
              ? 'saved choice on this device'
              : 'automatic Hindi-tag/name selection'}
          </p>
          <p>Voice quality depends on this device. Use the sample to compare installed voices.</p>
        </div>
      </section>

      {/*
       * THE FLOOR'S QUESTION, ABOVE THE KITCHEN'S WORK.
       *
       * A restaurant that has turned the rotating code off holds the first
       * order of each sitting until a person vouches for the table. It sits
       * above the columns, never inside them: a cook must not start food for a
       * ticket the floor has not accepted, and the columns are the cook's.
       */}
      <HeldTableStrip tables={data?.held ?? []} canConfirm={live && Boolean(data?.canAdvance)} />

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
                <button type="button" onClick={() => changeMissed(() => [])} className={btn('quiet', 'sm')}>
                  Dismiss
                </button>
              </span>
            }
          >
            {/* Two honest reasons, and they are not the same thing. */}
            {missedReason === 'queue'
              ? 'The speech queue was full. These orders remain on the board and can be replayed when it clears.'
              : missedReason === 'speaker'
                ? 'They arrived while another tab owned the speaker; replay them here if needed.'
              : missedReason === 'muted'
                ? 'They arrived while this screen was muted or the sound was off.'
                : voiceState === 'ready'
                  ? 'They were placed before this board was opened. The pass may have seen them already.'
                  : 'They arrived while this device had no voice to read them with.'}{' '}
            They are on the board below.
          </Notice>
        )}

        {speechWarning && (
          <Notice role="status" tone="accent" className="mb-0"
            label={<strong className="text-[12.5px] font-semibold text-gink">Announcement not queued.</strong>}
            action={<button type="button" onClick={() => setSpeechWarning('')} className={btn('quiet', 'sm')}>Dismiss</button>}
          >{speechWarning}</Notice>
        )}

        {live && (data?.cancelled.length ?? 0) > 0 && (
          <Panel title="Recent cancellations" meta="Kept for recovery · last 15 minutes" bodyClassName="">
            <ul className="divide-y divide-hair">
              {(data?.cancelled ?? []).map((row: CancelledTicket) => (
                <li key={row.id} className="flex items-center gap-3 px-3.5 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 font-medium text-gink">{row.table} · cancelled</span>
                  <button
                    type="button"
                    onClick={() => replay(`cancel-recovery:${row.id}:${Date.now()}`, cancelText(row.table), `${row.table} · cancelled`)}
                    className="shrink-0 text-[11.5px] font-medium text-gink-64 underline underline-offset-2 hover:text-gink"
                  >Replay cancellation</button>
                </li>
              ))}
            </ul>
          </Panel>
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
                  <span className="shrink-0 text-[10.5px] text-gink-46" aria-label={`Speech ${entry.status}`}>
                    {entry.status === 'queued' ? 'Queued' : entry.status === 'completed' ? 'Completed' : entry.status === 'failed' ? 'Failed' : 'Cancelled'}
                  </span>
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

      {/* Where the ticket went. Focusable, and focused, so a keyboard user is
          never dropped back at the top of the document by a card leaving the
          column they were working in. */}
      {moved && <TicketMovedNote ref={movedRef} text={moved} />}

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
            <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-hair pb-2.5">
              <h2 className="flex items-center gap-2 text-[13.5px] font-semibold tracking-[-0.014em] text-gink">
                {/* A 3px stage bar, not a 6px dot: at a metre and a half --
                    which is how a board is actually read -- a dot is
                    invisible and a bar is a column identity. */}
                <span
                  aria-hidden="true"
                  className={[
                    'h-3.5 w-[3px] rounded-full',
                    c.key === 'new'
                      ? 'bg-[var(--p-accent)]'
                      : c.key === 'preparing'
                        ? 'bg-gink'
                        : 'bg-[var(--p-live)]',
                  ].join(' ')}
                />
                {c.title}
              </h2>
              <span
                className={[
                  'tnum inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[11.5px] font-semibold',
                  c.key === 'new'
                    ? 'bg-[var(--p-accent-soft)] text-[var(--p-accent-strong)]'
                    : c.key === 'preparing'
                      ? 'bg-paper-deep text-gink'
                      : 'bg-[var(--p-live-soft)] text-[var(--p-live)]',
                ].join(' ')}
              >
                {c.orders.length}
              </span>
            </div>

            <div className="grid gap-2">
              {c.orders.map((o) => (
                <article
                  key={o.key}
                  data-state={o.state}
                  data-arriving={arrivals.includes(o.key) ? 'true' : undefined}
                  className={[
                    'relative overflow-hidden rounded-[var(--p-r-block)] border bg-card p-3',
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
                    <span className="rounded-[var(--p-r-chip)] bg-paper-deep px-1.5 py-0.5 text-[11.5px] font-semibold tracking-[0.04em] text-gink-80">
                      {o.table}
                    </span>
                    {/* Age is the one number a cook acts on without reading
                        anything else, so it is the loudest thing on the row --
                        inside the geometry every other status uses. */}
                    <span
                      className={[
                        'tnum ml-auto rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold tracking-[0.01em]',
                        o.ageMin >= LATE_AFTER_MIN
                          ? 'bg-[color-mix(in_oklab,var(--p-due)_10%,var(--p-card))] text-[var(--p-due)]'
                          : o.ageMin >= WARN_AFTER_MIN
                            ? 'bg-paper-deep text-gink-64'
                            : 'bg-accent-soft text-[var(--p-accent)]',
                      ].join(' ')}
                    >
                      {o.ageMin} min
                    </span>
                  </div>

                  {o.payment === 'pending' && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-[var(--p-r-chip)] bg-[color-mix(in_oklab,var(--p-due)_8%,var(--p-card))] px-2 py-1 text-[11.5px] font-medium text-[var(--p-due)]">
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
                      <button
                        type="button"
                        /* Full width below lg: this is the one tap the screen
                           exists for, and on a 390px card it used to share the
                           row with the total, the replay icon and the cancel
                           pair -- which put it at the right edge, half under a
                           thumb, on the narrowest screen in the product. */
                        className={`${kbBtn('solid')} max-lg:w-full`}
                        onClick={() => advance(o)}
                      >
                        Start preparing
                      </button>
                    )}
                    {interactive && o.state === 'preparing' && (
                      <button
                        type="button"
                        /* Full width below lg: this is the one tap the screen
                           exists for, and on a 390px card it used to share the
                           row with the total, the replay icon and the cancel
                           pair -- which put it at the right edge, half under a
                           thumb, on the narrowest screen in the product. */
                        className={`${kbBtn('solid')} max-lg:w-full`}
                        onClick={() => advance(o)}
                      >
                        Mark ready
                      </button>
                    )}
                    {interactive && o.state === 'ready' && (
                      <button
                        type="button"
                        /* Full width below lg: this is the one tap the screen
                           exists for, and on a 390px card it used to share the
                           row with the total, the replay icon and the cancel
                           pair -- which put it at the right edge, half under a
                           thumb, on the narrowest screen in the product. */
                        className={`${kbBtn('solid')} max-lg:w-full`}
                        onClick={() => advance(o)}
                      >
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

/**
 * Where a ticket went -- and where keyboard focus goes.
 *
 * THE ACCESSIBILITY CONTRACT, IN THREE PARTS
 *
 *   `tabIndex={-1}`     focusable by script and not by Tab. It is not an item
 *                       in the tab order: a cook is working a board, and a line
 *                       of text they did not open belongs behind Tab, not in it.
 *
 *   `ref` + the effect    pressing "Mark ready" removes that ticket's card from
 *                         the column you were working in. On a phone the whole
 *                         card leaves the screen, so focus was on a node that
 *                         no longer existed and silently reset to the top of
 *                         the document -- the next Tab starting at the rail.
 *                         The note takes focus instead.
 *
 *   `focus-visible`        focus is invisible without a keyboard, which is the
 *                          one case where an invisible focus is the whole
 *                          point: a mouse user sees the note move, and never
 *                          sees a focus ring drawn over it.
 *
 * `preventScroll` is deliberately NOT passed on the focus call: on a phone the
 * note sits above the columns, and scrolling it into view is how the cook
 * learns where the card went.
 */
export const TicketMovedNote = forwardRef<HTMLParagraphElement, { text: string }>(
  function TicketMovedNote({ text }, forwardedRef) {
    return (
      <p
        ref={forwardedRef}
        tabIndex={-1}
        className="mt-2 text-[12.5px] leading-[1.5] text-gink-64 focus-visible:rounded-[var(--p-r-chip)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)]"
      >
        {text}
      </p>
    );
  },
);

/**
 * What the board says after a ticket moves.
 *
 * The destination is named the way the column is named ("Ready / Served"), not
 * the way the database names it ("served"), because the person reading it is
 * looking at a column heading.
 */
const MOVED_TO: Record<PrepState, string> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready / Served',
  served: 'Ready / Served',
};

export function movedLine(ticket: Pick<BoardTicket, 'table' | 'code'>, next: PrepState): string {
  return `${ticket.table} · ${ticket.code} moved to ${MOVED_TO[next]}.`;
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
