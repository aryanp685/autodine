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

import { useState, useEffect, useRef } from 'react';
import { useAnnouncementsOptional } from './GlobalAnnouncementProvider';

function KindGlyph({ kind }: { kind: string }) {
  if (kind === 'waiter') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8.5a6 6 0 1 0-12 0c0 4.4-1.6 5.5-1.6 5.5h15.2S18 12.9 18 8.5" />
        <path d="M13.7 18.2a2 2 0 0 1-3.4 0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12l1.5 4.5H4.5L6 3Z" />
      <path d="M5 7.5V21h14V7.5" />
      <path d="M9.5 21v-5.5h5V21" />
    </svg>
  );
}

function BellGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8.5a6 6 0 1 0-12 0c0 4.4-1.6 5.5-1.6 5.5h15.2S18 12.9 18 8.5" />
      <path d="M13.7 18.2a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function ClockLabel({ iso }: { iso: number | string }) {
  return (
    <>
      {new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </>
  );
}

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
        className="relative grid size-9 shrink-0 place-items-center rounded-full border border-hair bg-card text-gink-64 transition-[background-color,color,box-shadow,transform] duration-150 ease-[var(--o-ease)] hover:-translate-y-px hover:bg-paper-deep hover:text-gink hover:shadow-[var(--p-shadow-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--p-accent)] active:translate-y-0"
      >
        <BellGlyph />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--p-accent)] px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-[var(--p-card)]">
            {unreadCount > 9 ? '9+' : unreadCount}
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
            className="fixed inset-x-3 top-[64px] z-50 overflow-hidden rounded-[16px] border border-hair-strong bg-card shadow-[0_18px_50px_rgba(43,32,21,0.16),0_2px_6px_rgba(43,32,21,0.06)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[392px]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-hair px-4 py-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-gink">
                  Notifications
                </h2>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-[var(--p-accent-soft)] px-2 py-[2px] text-[10.5px] font-semibold text-[var(--p-accent-strong)]">
                    {unreadCount} new
                  </span>
                )}
              </div>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="rounded-full px-2 py-1 text-[11.5px] font-medium text-gink-46 transition-colors hover:bg-gink-07 hover:text-gink"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[56vh] overflow-auto overscroll-contain">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
                  <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-paper-deep text-gink-46">
                    <BellGlyph />
                  </span>
                  <p className="text-[13px] font-medium text-gink">All quiet</p>
                  <p className="max-w-[240px] text-[11.5px] leading-snug text-gink-46">
                    New orders and waiter calls will land here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-hair">
                  {notifications.map((n) => (
                    <li
                      key={n.id}
                      data-notification-id={n.id}
                      className={[
                        'group relative flex gap-3 px-4 py-3.5 transition-colors',
                        !n.read
                          ? 'bg-[color-mix(in_oklab,var(--p-accent-soft)_34%,transparent)]'
                          : 'hover:bg-paper-deep/60',
                      ].join(' ')}
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-[9px]',
                          n.kind === 'waiter'
                            ? 'bg-[color-mix(in_oklab,var(--p-live)_12%,transparent)] text-[var(--p-live)]'
                            : 'bg-[color-mix(in_oklab,var(--p-accent)_10%,transparent)] text-[var(--p-accent-strong)]',
                        ].join(' ')}
                      >
                        <KindGlyph kind={n.kind} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-semibold leading-snug tracking-[-0.005em] text-gink">
                            {n.title}
                          </p>
                          <span className="shrink-0 pt-0.5 text-[10.5px] tabular-nums text-gink-46">
                            <ClockLabel iso={n.createdAt} />
                          </span>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug text-gink-64">{n.body}</p>
                        {n.orderDetails && (
                          <div className="mt-2 rounded-[9px] border border-hair bg-paper-deep/70 px-3 py-2">
                            <p className="text-[11px] font-semibold tracking-[0.04em] text-gink uppercase">
                              {n.orderDetails.code}
                            </p>
                            <ul className="mt-1 space-y-0.5">
                              {n.orderDetails.items.map((it, idx) => (
                                <li key={idx} className="text-[11.5px] leading-snug text-gink-64">
                                  <span className="font-medium tabular-nums text-gink">{it.qty}×</span> {it.name}
                                  {it.detail ? ` · ${it.detail}` : ''}
                                </li>
                              ))}
                            </ul>
                            {n.orderDetails.note && (
                              <p className="mt-1.5 border-l-2 border-[var(--p-accent)] pl-2 text-[11.5px] italic leading-snug text-gink-64">
                                “{n.orderDetails.note}”
                              </p>
                            )}
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-3">
                          <span className="text-[10.5px] font-medium tracking-[0.06em] text-gink-46 uppercase">
                            {n.kind === 'order' ? 'Order' : 'Waiter call'}
                          </span>
                          {!n.read && (
                            <button
                              type="button"
                              onClick={() => markRead(n.id)}
                              className="text-[10.5px] font-semibold text-[var(--p-accent-strong)] transition-opacity hover:opacity-70"
                            >
                              Mark read
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => dismiss(n.id)}
                            className="ml-auto text-[10.5px] font-medium text-gink-46 opacity-0 transition-opacity hover:text-gink group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={`Dismiss ${n.title}`}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                      {!n.read && (
                        <span aria-hidden="true" className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-[var(--p-accent)]" />
                      )}
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

/**
 * Toast stack: shows the newest arrivals briefly, premium cards with a
 * lifetime rail. Restored (persisted) notifications never toast on mount:
 * only items created after this page load surface, so a refresh does not
 * replay yesterday's waiter calls.
 */
export function AnnouncementToasts() {
  const ctx = useAnnouncementsOptional();
  if (!ctx) return null;

  const { notifications } = ctx;
  const [visible, setVisible] = useState<string[]>([]);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const fresh = notifications
      .filter((n) => new Date(n.createdAt).getTime() > mountedAt.current)
      .slice(0, 3);
    if (fresh.length === 0) return;
    const ids = fresh.map((n) => n.id);
    setVisible(ids);
    const timer = setTimeout(() => setVisible([]), 6000);
    return () => clearTimeout(timer);
  }, [notifications.length]); // only when count changes (new arrivals)

  if (visible.length === 0) return null;

  const toShow = notifications.filter((n) => visible.includes(n.id)).slice(0, 3);
  if (toShow.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-4 left-4 z-50 flex flex-col gap-2 sm:left-auto sm:max-w-[360px]"
    >
      {toShow.map((n) => (
        <div
          key={n.id}
          role="status"
          data-announcement-toast={n.id}
          className="pointer-events-auto relative overflow-hidden rounded-[14px] border border-hair-strong bg-card shadow-[0_14px_40px_rgba(43,32,21,0.16),0_2px_6px_rgba(43,32,21,0.06)]"
        >
          <span
            aria-hidden="true"
            className={[
              'absolute inset-y-0 left-0 w-[3px]',
              n.kind === 'waiter' ? 'bg-[var(--p-live)]' : 'bg-[var(--p-accent)]',
            ].join(' ')}
          />
          <div className="flex items-start gap-3 py-3 pr-3 pl-4">
            <span
              aria-hidden="true"
              className={[
                'mt-0.5 grid size-7 shrink-0 place-items-center rounded-[9px]',
                n.kind === 'waiter'
                  ? 'bg-[color-mix(in_oklab,var(--p-live)_12%,transparent)] text-[var(--p-live)]'
                  : 'bg-[color-mix(in_oklab,var(--p-accent)_10%,transparent)] text-[var(--p-accent-strong)]',
              ].join(' ')}
            >
              <KindGlyph kind={n.kind} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold leading-snug tracking-[-0.005em] text-gink">
                {n.title}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-gink-64">{n.body}</p>
            </div>
            <button
              type="button"
              onClick={() => setVisible((prev) => prev.filter((id) => id !== n.id))}
              className="shrink-0 rounded-full p-1 text-gink-46 transition-colors hover:bg-gink-07 hover:text-gink"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
          <span
            aria-hidden="true"
            className="toast-life absolute inset-x-0 bottom-0 h-[2px] origin-left bg-[var(--p-accent)]/50"
          />
        </div>
      ))}
    </div>
  );
}
