'use client';

/**
 * Global Announcement Provider
 *
 * MANDATORY: Voice + written notifications on EVERY staff page, not just kitchen.
 * - Mounted in StaffShell (layout), persists across route changes
 * - Single polling listener (no duplicates per page)
 * - Idempotent via seen-set (per restaurant, per event)
 * - Handles reconnect, recovers missed, respects Sound ON/OFF (written always)
 * - Respects browser autoplay (requires user gesture before voice)
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  claimKitchenOrderAnnouncementAction,
  claimTableWaiterCallAnnouncementAction,
  recordKitchenAnnouncementResultAction,
  recordTableWaiterCallAnnouncementAction,
} from '@/app/(staff)/kitchen/actions';
import { createAnnounceQueue, type AnnounceQueue } from '@/lib/announce';
import {
  browserSpeechEnv,
  createChime,
  createKitchenSpeech,
  type SpeechEngine,
} from '@/lib/speech';
import { createServerSpeech } from '@/lib/server-speech';
import { browserServerSpeechEnv } from '@/lib/server-speech-browser';
import { createDualSpeech } from '@/lib/dual-speech';
import {
  eventToNotification,
  eventToVoiceText,
  filterUnseenEvents,
  updateSeenWithEvents,
  addNotifications,
  measureLatencyMs,
} from '@/lib/announcements/store';
import type {
  AnnouncementEvent,
  AnnouncementSettings,
  WrittenNotification,
  SeenState,
} from '@/lib/announcements/types';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SEEN_KEY,
  NOTIFICATIONS_KEY,
  POLL_INTERVAL_MS,
  MAX_NOTIFICATIONS,
} from '@/lib/announcements/types';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type AnnouncementContextValue = {
  /** Written notifications inbox */
  notifications: WrittenNotification[];
  unreadCount: number;
  /** Mark as read */
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  /** Settings */
  settings: AnnouncementSettings;
  setSettings: (next: Partial<AnnouncementSettings>) => void;
  /** Voice state */
  voiceAvailable: boolean;
  voiceName: string | null;
  hindiVoices: { name: string; lang: string }[];
  englishVoices: { name: string; lang: string }[];
  voiceState: 'starting' | 'ready' | 'no-voice';
  /** Controls */
  testVoice: (text?: string) => void;
  enableSound: () => void;
  /** For UI: last announcement info */
  lastAnnouncement: string | null;
  speaking: boolean;
  gestured: boolean;
};

const AnnouncementContext = createContext<AnnouncementContextValue | null>(null);

export function useAnnouncements(): AnnouncementContextValue {
  const ctx = useContext(AnnouncementContext);
  if (!ctx) throw new Error('useAnnouncements must be used within GlobalAnnouncementProvider');
  return ctx;
}

/** Safe optional hook for components that may render outside the provider (tests, demo) */
export function useAnnouncementsOptional(): AnnouncementContextValue | null {
  return useContext(AnnouncementContext);
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readSettings(restaurantId: string | null): AnnouncementSettings {
  if (!restaurantId) return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY(restaurantId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AnnouncementSettings>;
      return {
        soundOn: typeof parsed.soundOn === 'boolean' ? parsed.soundOn : DEFAULT_SETTINGS.soundOn,
        lang: parsed.lang === 'en' || parsed.lang === 'hi' ? parsed.lang : DEFAULT_SETTINGS.lang,
        voiceName: typeof parsed.voiceName === 'string' ? parsed.voiceName : null,
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(restaurantId: string | null, s: AnnouncementSettings) {
  if (!restaurantId) return;
  try {
    localStorage.setItem(SETTINGS_KEY(restaurantId), JSON.stringify(s));
  } catch {}
}

function readSeen(restaurantId: string | null): SeenState {
  if (!restaurantId) return { orderIds: [], waiterCallIds: [] };
  try {
    const raw = sessionStorage.getItem(SEEN_KEY(restaurantId));
    if (raw) {
      const parsed = JSON.parse(raw) as SeenState;
      if (Array.isArray(parsed.orderIds) && Array.isArray(parsed.waiterCallIds)) return parsed;
    }
  } catch {}
  return { orderIds: [], waiterCallIds: [] };
}

function writeSeen(restaurantId: string | null, seen: SeenState) {
  if (!restaurantId) return;
  try {
    sessionStorage.setItem(SEEN_KEY(restaurantId), JSON.stringify(seen));
  } catch {}
}

function readNotifications(restaurantId: string | null): WrittenNotification[] {
  if (!restaurantId) return [];
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_KEY(restaurantId));
    if (raw) {
      const parsed = JSON.parse(raw) as WrittenNotification[];
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_NOTIFICATIONS);
    }
  } catch {}
  return [];
}

function writeNotifications(restaurantId: string | null, list: WrittenNotification[]) {
  if (!restaurantId) return;
  try {
    localStorage.setItem(NOTIFICATIONS_KEY(restaurantId), JSON.stringify(list.slice(0, MAX_NOTIFICATIONS)));
  } catch {}
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function GlobalAnnouncementProvider({
  restaurantId,
  children,
}: {
  restaurantId: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // If no restaurant (demo / signed-out), just render children without polling
  const isStaffRoute = restaurantId !== null;

  // Settings (per-restaurant)
  const [settings, setSettingsState] = useState<AnnouncementSettings>(() => readSettings(restaurantId));

  // Restore settings when restaurant changes
  useEffect(() => {
    setSettingsState(readSettings(restaurantId));
  }, [restaurantId]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const setSettings = useCallback(
    (next: Partial<AnnouncementSettings>) => {
      setSettingsState((prev) => {
        const updated = { ...prev, ...next };
        writeSettings(restaurantId, updated);
        return updated;
      });
    },
    [restaurantId],
  );

  // Notifications inbox
  const [notifications, setNotifications] = useState<WrittenNotification[]>(() => readNotifications(restaurantId));

  useEffect(() => {
    setNotifications(readNotifications(restaurantId));
  }, [restaurantId]);

  const addToInbox = useCallback(
    (incoming: WrittenNotification[]) => {
      setNotifications((prev) => {
        const next = addNotifications(prev, incoming);
        writeNotifications(restaurantId, next);
        return next;
      });
    },
    [restaurantId],
  );

  const markRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
        writeNotifications(restaurantId, next);
        return next;
      });
    },
    [restaurantId],
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      writeNotifications(restaurantId, next);
      return next;
    });
  }, [restaurantId]);

  const dismiss = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.filter((n) => n.id !== id);
        writeNotifications(restaurantId, next);
        return next;
      });
    },
    [restaurantId],
  );

  const clearAll = useCallback(() => {
    setNotifications([]);
    writeNotifications(restaurantId, []);
  }, [restaurantId]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  // Voice engine state
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [hindiVoices, setHindiVoices] = useState<{ name: string; lang: string }[]>([]);
  const [englishVoices, setEnglishVoices] = useState<{ name: string; lang: string }[]>([]);
  const [voiceState, setVoiceState] = useState<'starting' | 'ready' | 'no-voice'>('starting');
  const [speaking, setSpeaking] = useState(false);
  const [lastAnnouncement, setLastAnnouncement] = useState<string | null>(null);
  const [gestured, setGestured] = useState(false);

  const speechRef = useRef<SpeechEngine | null>(null);
  const queueRef = useRef<AnnounceQueue | null>(null);
  const seenRef = useRef<SeenState>(readSeen(restaurantId));
  const primedRef = useRef(false);
  const activeRestaurantRef = useRef<string | null | undefined>(undefined);
  const notificationIdsRef = useRef<Set<string>>(new Set());
  // Track event keys that have been spoken to prevent duplicates
  const spokenEventKeysRef = useRef<Set<string>>(new Set());
  // For latency measurement: eventAt per voiceKey, to compute event-to-audio-completion at onResult
  const eventAtByVoiceKeyRef = useRef<Map<string, string>>(new Map());

  // Initialize speech engine ONCE per restaurant
  useEffect(() => {
    if (!isStaffRoute || !restaurantId) {
      speechRef.current = null;
      queueRef.current = null;
      return;
    }

    // Reset per-restaurant state when restaurant changes
    if (activeRestaurantRef.current !== restaurantId) {
      activeRestaurantRef.current = restaurantId;
      seenRef.current = readSeen(restaurantId);
      primedRef.current = false;
      spokenEventKeysRef.current = new Set();
      notificationIdsRef.current = new Set(readNotifications(restaurantId).map((n) => n.id));
    }

    const chime = createChime();
    const serverEngine = createServerSpeech(browserServerSpeechEnv(chime));
    const browserEngine = createKitchenSpeech(browserSpeechEnv(chime));
    const dualEngine = createDualSpeech(serverEngine, browserEngine);
    speechRef.current = dualEngine;

    // Voice resolution
    const VOICE_WAIT_MS = 5000;
    let settled = false;

    const resolveVoice = () => {
      dualEngine.refreshVoices();
      const lang = settingsRef.current.lang;
      dualEngine.setTargetFamily(lang === 'en' ? 'en' : 'hi');
      if (settingsRef.current.voiceName) {
        dualEngine.setVoiceName(settingsRef.current.voiceName);
      }
      const available = dualEngine.available();
      const name = dualEngine.voiceName();
      const hiVoices = dualEngine.hindiVoices().map((v) => ({ name: v.name, lang: v.lang }));
      const enVoices = dualEngine.englishVoices().map((v) => ({ name: v.name, lang: v.lang }));

      setHindiVoices(hiVoices);
      setEnglishVoices(enVoices);
      setVoiceAvailable(available);
      setVoiceName(name);

      if (name) {
        setVoiceState('ready');
        settled = true;
      } else if (dualEngine.unavailable()) {
        setVoiceState('no-voice');
        settled = true;
      }
    };

    resolveVoice();

    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    synth?.addEventListener?.('voiceschanged', resolveVoice);

    const giveUp = setTimeout(() => {
      if (settled) return;
      resolveVoice();
      if (!settled) {
        setVoiceState('no-voice');
        settled = true;
      }
    }, VOICE_WAIT_MS);

    // Speech queue — single instance, persists across route changes
    const queue = createAnnounceQueue(
      {
        speak(text, onEnd) {
          const engine = speechRef.current;
          const s = settingsRef.current;
          if (!s.soundOn) {
            onEnd({ status: 'failed', reason: 'Sound is off', completedSegments: 0, totalSegments: 1 });
            return;
          }
          if (!engine || !engine.available()) {
            onEnd({ status: 'failed', reason: 'No voice available', completedSegments: 0, totalSegments: 1 });
            return;
          }
          // Record latency metric
          try {
            engine.speak(text, onEnd);
          } catch (err) {
            onEnd({
              status: 'failed',
              reason: err instanceof Error ? err.message : 'Speech engine error',
              completedSegments: 0,
              totalSegments: 1,
            });
          }
        },
      },
      {
        onBegin(entry) {
          setSpeaking(true);
          setLastAnnouncement(entry.text);
        },
        onResult(entry, outcome) {
          // Latency: event-to-audio-completion measured here (only after actual playback via onend/onended)
          const eventAt = eventAtByVoiceKeyRef.current.get(entry.key);
          if (eventAt) {
            const audioLatency = measureLatencyMs(eventAt, Date.now());
            if (audioLatency >= 0) {
              // Separate from event-to-notification (measured at claim time); this includes TTS fetch + playback
              console.log(`[announcement] event-to-audio: ${audioLatency}ms for ${entry.key} status=${outcome.status}`);
              if (audioLatency > 10000) console.warn(`[announcement] high audio latency: ${audioLatency}ms for ${entry.key}`);
            }
            eventAtByVoiceKeyRef.current.delete(entry.key);
          }
          // For accurate audio confirmation: only 'completed' means audio playback finished
          // 'failed' means either synthesis failed OR playback failed
          if (outcome.status === 'completed') {
            // Record success in DB for order events
            const orderId = entry.key.startsWith('order:') ? entry.key.slice(6) : null;
            const waiterId = entry.key.startsWith('waiter:') ? entry.key.slice(7) : null;
            if (orderId) {
              void recordKitchenAnnouncementResultAction({
                orderId,
                status: 'announced',
              }).catch(() => undefined);
            } else if (waiterId) {
              void recordTableWaiterCallAnnouncementAction({
                callId: waiterId,
                status: 'announced',
              }).catch(() => undefined);
            }
          } else if (outcome.status === 'failed') {
            const orderId = entry.key.startsWith('order:') ? entry.key.slice(6) : null;
            const waiterId = entry.key.startsWith('waiter:') ? entry.key.slice(7) : null;
            if (orderId) {
              void recordKitchenAnnouncementResultAction({
                orderId,
                status: 'failed',
                failureReason: outcome.reason,
              }).catch(() => undefined);
            } else if (waiterId) {
              void recordTableWaiterCallAnnouncementAction({
                callId: waiterId,
                status: 'failed',
                failureReason: outcome.reason,
              }).catch(() => undefined);
            }
          }
        },
        onIdle() {
          setSpeaking(false);
        },
      },
    );
    queueRef.current = queue;

    return () => {
      clearTimeout(giveUp);
      synth?.removeEventListener?.('voiceschanged', resolveVoice);
      queue.dispose();
      dualEngine.cancel();
      speechRef.current = null;
      queueRef.current = null;
    };
  }, [restaurantId, isStaffRoute]);

  // React to settings changes: update engine
  useEffect(() => {
    const engine = speechRef.current;
    if (!engine) return;
    engine.setTargetFamily(settings.lang === 'en' ? 'en' : 'hi');
    if (settings.voiceName) {
      engine.setVoiceName(settings.voiceName);
    } else {
      engine.setVoiceName(null);
    }
    // Refresh voice lists
    setVoiceName(engine.voiceName());
    setHindiVoices(engine.hindiVoices().map((v) => ({ name: v.name, lang: v.lang })));
    setEnglishVoices(engine.englishVoices().map((v) => ({ name: v.name, lang: v.lang })));
    setVoiceAvailable(engine.available());
  }, [settings.lang, settings.voiceName]);

  // Browser autoplay: require gesture before voice
  useEffect(() => {
    if (!isStaffRoute) return;
    const unlock = () => {
      setGestured(true);
      speechRef.current?.refreshVoices();
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [isStaffRoute]);

  // Enable sound via explicit call (Settings toggle)
  const enableSound = useCallback(() => {
    setGestured(true);
    setSettings({ soundOn: true });
    speechRef.current?.refreshVoices();
  }, [setSettings]);

  // Test voice: speak a sample sentence with current settings
  const testVoice = useCallback(
    (text?: string) => {
      const lang = settingsRef.current.lang;
      const sample =
        text ??
        (lang === 'hi'
          ? 'नया ऑर्डर आया है। टेबल पाँच। दो पनीर बटर मसाला और एक बटर नान।'
          : 'New order for Table 5. Two Paneer Butter Masala and one Butter Naan.');
      const engine = speechRef.current;
      if (!engine) return;
      // Use the speech engine directly for test (bypasses queue to give immediate feedback)
      // But also go through queue if we want to test queue
      const queue = queueRef.current;
      if (queue) {
        const key = `test:${Date.now()}`;
        queue.push(key, sample, 'order');
      } else {
        engine.speak(sample, () => {});
      }
    },
    [],
  );

  // Polling: fetch announcement events globally
  useEffect(() => {
    if (!isStaffRoute || !restaurantId) return;

    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.hidden) return; // skip when hidden

      try {
        const res = await fetch('/api/staff/announcement-events', {
          headers: { 'Cache-Control': 'no-store' },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { restaurantId: string; events: AnnouncementEvent[]; serverTime: string };

        if (stopped) return;
        // Ignore if restaurant changed during fetch
        if (data.restaurantId !== restaurantId) return;

        const events = data.events ?? [];
        if (events.length === 0) return;

        // Prime on first load: mark all existing as seen, do NOT announce history
        if (!primedRef.current) {
          primedRef.current = true;
          // All current events are "existing" — mark as seen without announcing
          // But allow very recent orders (last 2 minutes) to be announced if not yet seen
          // Actually: strict prime = mark all as seen silently, to avoid burst on provider mount
          const newSeen = updateSeenWithEvents(seenRef.current, events);
          seenRef.current = newSeen;
          writeSeen(restaurantId, newSeen);
          return;
        }

        // Filter to unseen only — idempotency
        const unseen = filterUnseenEvents(events, seenRef.current);
        if (unseen.length === 0) return;

        // Reserve all unseen in seen-set BEFORE async claim attempts
        // This prevents a re-render/poll from starting overlapping claims for same events
        const reservedSeen = updateSeenWithEvents(seenRef.current, unseen);
        seenRef.current = reservedSeen;
        writeSeen(restaurantId, reservedSeen);

        const receivedAt = new Date().toISOString();
        const lang = settingsRef.current.lang;
        const notificationsToAdd: WrittenNotification[] = [];

        for (const event of unseen) {
          // Deduplicate voice keys: same order/waiter never spoken twice
          const voiceKey = event.kind === 'order' ? `order:${event.orderId}` : `waiter:${event.callId}`;
          if (spokenEventKeysRef.current.has(voiceKey)) continue;

          // Written notification: ALWAYS created, even when Sound is OFF
          const notification = eventToNotification(event, lang, receivedAt);
          // Dedup inbox by notification id
          if (!notificationIdsRef.current.has(notification.id)) {
            notificationIdsRef.current.add(notification.id);
            notificationsToAdd.push(notification);
          }

          // Voice announcement: only if Sound ON and engine available
          // Uses DB claim for cross-device deduplication before speaking
          const voiceText = eventToVoiceText(event, lang);
          const queue = queueRef.current;
          if (!queue) continue;
          if (!settingsRef.current.soundOn) continue; // Sound off → written only

          let claimOk = false;
          let claimed = false;
          try {
            if (event.kind === 'order') {
              const result = await claimKitchenOrderAnnouncementAction(event.orderId);
              claimOk = result.ok;
              claimed = result.ok && result.claimed;
              if (!result.ok) {
                // Claim failed (network/auth) → written notification still exists, voice skipped
                continue;
              }
              if (!claimed) {
                // Another device won the claim — this device stays silent for voice,
                // but written notification already created above
                continue;
              }
            } else {
              const result = await claimTableWaiterCallAnnouncementAction(event.callId);
              claimOk = result.ok;
              claimed = result.ok && result.claimed;
              if (!result.ok || !claimed) continue;
            }
          } catch {
            // Network error during claim → written preserved, voice skipped for this poll
            // Will remain as 'pending' and be recovered by another device or next poll after recovery timeout
            continue;
          }

          if (claimed) {
            // Only the winner speaks. Track to prevent local duplicates.
            spokenEventKeysRef.current.add(voiceKey);
            // Track eventAt for event-to-audio latency (measured at onResult after playback)
            eventAtByVoiceKeyRef.current.set(voiceKey, event.eventAt);

            // Latency: event-to-notification (poll receipt + claim) — separate from event-to-audio
            const latency = measureLatencyMs(event.eventAt, Date.now());
            if (latency >= 0 && latency > 0) {
              console.log(`[announcement] event-to-notification: ${latency}ms for ${voiceKey}`);
              if (latency > 10000) {
                console.warn(`[announcement] high notification latency: ${latency}ms for ${voiceKey}`);
              }
            }

            const result = queue.push(voiceKey, voiceText, 'order');
            if (result !== 'queued') {
              // Queue full or duplicate — log but don't crash
              // The written notification still exists; voice can be retried via replay or recovery
              spokenEventKeysRef.current.delete(voiceKey);
            }
          }
        }

        if (notificationsToAdd.length > 0) {
          addToInbox(notificationsToAdd);
        }
      } catch {
        // Network error — polling continues; next tick will retry
      }
    };

    // Initial poll shortly after mount
    const initialDelay = setTimeout(poll, 1500);
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);

    // Visibility change: immediate poll when tab becomes visible
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Also poll on window focus (covers some mobile browser cases)
    window.addEventListener('focus', onVisible);

    return () => {
      stopped = true;
      clearTimeout(initialDelay);
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [restaurantId, isStaffRoute, addToInbox]);

  const value = useMemo<AnnouncementContextValue>(
    () => ({
      notifications,
      unreadCount,
      markRead,
      markAllRead,
      dismiss,
      clearAll,
      settings,
      setSettings,
      voiceAvailable,
      voiceName,
      hindiVoices,
      englishVoices,
      voiceState,
      testVoice,
      enableSound,
      lastAnnouncement,
      speaking,
      gestured,
    }),
    [notifications, unreadCount, markRead, markAllRead, dismiss, clearAll, settings, setSettings, voiceAvailable, voiceName, hindiVoices, englishVoices, voiceState, testVoice, enableSound, lastAnnouncement, speaking, gestured],
  );

  return <AnnouncementContext.Provider value={value}>{children}</AnnouncementContext.Provider>;
}
