'use client';

/**
 * AnnouncementInbox
 *
 * Written-notification UI — visible on EVERY staff page via StaffShell.
 * - Bell icon with unread badge in the top bar
 * - Dropdown list: newest first, table + items + note + time
 * - Works even when Sound is OFF (written always delivered)
 * - Toast stack for instant visibility
 */

import { useState, useEffect } from 'react';
import { useAnnouncementsOptional } from './GlobalAnnouncementProvider';

export function AnnouncementInbox() {
  const ctx = useAnnouncementsOptional();
  if (!ctx) return null;

  const { notifications, unreadCount, markRead, markAllRead, dismiss } = ctx;
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-full border border-hair bg-card text-gink transition-colors hover:bg-paper-deep"
      >
        {/* Bell icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7-6 11-6 11s-6-4-6-11Z" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[var(--p-live)] px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Announcement notifications"
            className="absolute right-0 top-11 z-50 max-h-[70vh] w-[380px] overflow-hidden rounded-[12px] border border-hair-strong bg-card shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-hair px-4 py-3">
              <h2 className="text-sm font-semibold text-gink">
                Notifications {unreadCount > 0 ? `· ${unreadCount} new` : ''}
              </h2>
              <div className="flex items-center gap-1.5">
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="rounded-full px-2.5 py-1 text-xs font-medium text-gink-64 hover:bg-gink-07 hover:text-gink"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid size-7 place-items-center rounded-full text-gink-64 hover:bg-gink-07"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="max-h-[52vh] overflow-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-gink-46">
                  No announcements yet. New orders and waiter calls will appear here.
                </p>
              ) : (
                <ul className="divide-y divide-hair">
                  {notifications.map((n) => (
                    <li
                      key={n.id}
                      data-notification-id={n.id}
                      className={`flex gap-3 px-4 py-3 ${!n.read ? 'bg-[color-mix(in_oklab,var(--p-accent-soft)_40%,transparent)]' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight text-gink">{n.title}</p>
                        <p className="mt-1 text-xs leading-snug text-gink-64">{n.body}</p>
                        {n.orderDetails && (
                          <div className="mt-2 rounded-md bg-paper-deep px-2.5 py-2">
                            <p className="text-xs font-medium text-gink">Order: {n.orderDetails.code}</p>
                            <ul className="mt-1 space-y-0.5">
                              {n.orderDetails.items.map((it, idx) => (
                                <li key={idx} className="text-xs text-gink-64">
                                  {it.qty}× {it.name}
                                  {it.detail ? ` · ${it.detail}` : ''}
                                </li>
                              ))}
                            </ul>
                            {n.orderDetails.note && (
                              <p className="mt-1 border-l-2 border-hair pl-2 text-xs italic text-gink-64">
                                “{n.orderDetails.note}”
                              </p>
                            )}
                          </div>
                        )}
                        <p className="mt-1.5 text-[11px] text-gink-46">
                          {new Date(n.createdAt).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {n.kind === 'order' ? ' · Order' : ' · Waiter call'}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {!n.read && (
                          <button
                            type="button"
                            onClick={() => markRead(n.id)}
                            className="rounded-full bg-card px-2 py-1 text-xs font-medium text-gink hover:bg-paper-deep"
                          >
                            Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => dismiss(n.id)}
                          className="rounded-full px-2 py-1 text-xs text-gink-46 hover:text-gink"
                          aria-label={`Dismiss ${n.title}`}
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Toast stack: shows last 2-3 notifications briefly */
export function AnnouncementToasts() {
  const ctx = useAnnouncementsOptional();
  if (!ctx) return null;

  const { notifications } = ctx;
  const [visible, setVisible] = useState<string[]>([]);

  const latest = notifications.slice(0, 3);

  useEffect(() => {
    if (latest.length === 0) return;
    const ids = latest.map((n) => n.id);
    setVisible(ids);
    const timer = setTimeout(() => setVisible([]), 6000);
    return () => clearTimeout(timer);
  }, [notifications.length]); // only when count changes (new arrivals)

  if (visible.length === 0) return null;

  const toShow = latest.filter((n) => visible.includes(n.id));
  if (toShow.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-4 z-50 flex max-w-[380px] flex-col gap-2"
    >
      {toShow.map((n) => (
        <div
          key={n.id}
          role="status"
          data-announcement-toast={n.id}
          className="pointer-events-auto rounded-lg border border-hair-strong bg-card px-4 py-3 shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gink">{n.title}</p>
              <p className="mt-0.5 text-xs leading-snug text-gink-64">{n.body}</p>
            </div>
            <button
              type="button"
              onClick={() => setVisible((prev) => prev.filter((id) => id !== n.id))}
              className="shrink-0 rounded-full p-1 text-gink-46 hover:text-gink"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
