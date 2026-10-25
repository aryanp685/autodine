'use client';

import { useState, useTransition } from 'react';
import { confirmTableAction, rejectTableAction } from '@/app/kitchen/actions';
import type { HeldTable } from '@/lib/db/kitchen-screen';
import { btn } from '@/components/owner/chrome';

/**
 * The strip above the kitchen columns: "Waiting for the floor".
 *
 * WHY IT EXISTS
 *
 * A restaurant can turn the rotating code off and let a scan mint the table
 * session (migration 20261028000900). At that point nothing on the guest's
 * phone can prove the party is really at the table, so the first order of a
 * sitting is held until a person says the table is theirs. This is that person,
 * that place, and that moment -- and it is deliberately ONE TAP PER TABLE, not
 * one per order, because the second order from a sitting somebody already
 * vouched for is not a new question.
 *
 * WHAT THE TAP CLAIMS
 *
 * Precisely this: "a party is sitting at this table". Not that the phone is in
 * the room, not that the QR was not photographed. A static printed card cannot
 * be made to prove presence, and a button that pretends otherwise would be
 * worse than no button.
 *
 * DUPLICATES
 *
 * The server action sends a session id and nothing else; the database's UPDATE
 * only matches rows where confirmed_at is null, so the second tap -- another
 * tablet, an impatient finger -- changes zero rows and is reported as "already
 * confirmed" rather than as an error. This component then drops the card,
 * because the question it was asking has been answered by somebody.
 *
 * WHY THE STRIP IS SEPARATE FROM THE COLUMNS
 *
 * A cook must never see a held ticket in "New". The board's columns are the
 * work; this strip is a question about the floor. Keeping them in different
 * components is what stops the question from being silently promoted to work.
 */
export function HeldTableStrip({
  tables,
  canConfirm,
}: {
  tables: HeldTable[];
  /** Owner, manager or kitchen, on a restaurant that is not read-only. */
  canConfirm: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (tables.length === 0) return null;

  const totalItems = tables.reduce((sum, table) => sum + table.itemCount, 0);

  function confirm(sessionId: string) {
    setBusy(sessionId);
    setMessage(null);
    startTransition(async () => {
      const result = await confirmTableAction(sessionId);
      setBusy(null);
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error });
        return;
      }
      setMessage({
        tone: 'ok',
        text:
          result.confirmed > 0
            ? `Confirmed. ${result.confirmed} ticket${result.confirmed === 1 ? '' : 's'} now cooking.`
            : 'Already confirmed on another screen.',
      });
    });
  }

  function reject(sessionId: string) {
    setBusy(sessionId);
    setMessage(null);
    startTransition(async () => {
      const result = await rejectTableAction(sessionId, 'table not confirmed by staff');
      setBusy(null);
      setRejecting(null);
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error });
        return;
      }
      setMessage({
        tone: 'ok',
        text:
          result.confirmed > 0
            ? `Cancelled ${result.confirmed} unconfirmed ticket${result.confirmed === 1 ? '' : 's'}. Nothing reached a cook.`
            : 'Nothing left to cancel.',
      });
    });
  }

  return (
    <section
      aria-label="Tables waiting for confirmation"
      className="mb-3 overflow-hidden rounded-[var(--p-r-card)] border border-[color-mix(in_oklab,var(--p-due)_28%,transparent)] bg-[color-mix(in_oklab,var(--p-due-soft)_55%,var(--p-card))]"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[color-mix(in_oklab,var(--p-due)_18%,transparent)] px-4 py-2.5">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.014em] text-gink">
          Waiting for the floor
        </h2>
        <span className="text-[11.5px] text-gink-46">
          {tables.length === 1 ? '1 table' : `${tables.length} tables`} · {totalItems}{' '}
          {totalItems === 1 ? 'item' : 'items'} held. Nothing here is cooking yet.
        </span>
      </div>

      <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {tables.map((table) => {
          const id = table.sessionId;
          // The row's identity is its session; the fallback is only for the
          // impossible case, and it must not collide with `null` -- keying the
          // reject state by a null id made every orphan row open straight into
          // its confirmation step, which a test caught.
          const rowKey = id ?? table.orders[0]?.id ?? table.placedAtIso;
          const isBusy = busy === rowKey || pending;
          const canAct = canConfirm && Boolean(id) && !isBusy;
          const isRejecting = rejecting === rowKey;

          return (
            <li
              key={rowKey}
              className="rounded-[var(--p-r-block)] border border-hair bg-card p-3 shadow-[var(--p-shadow-1)]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-semibold text-gink">Table {table.table}</p>
                <p className="tnum text-[11.5px] text-gink-46">
                  {table.ageMin === 0 ? 'just now' : `${table.ageMin} min`}
                </p>
              </div>

              <p className="mt-0.5 text-[11.5px] text-gink-46">
                {table.orders.length === 1 ? '1 order' : `${table.orders.length} orders`} ·{' '}
                {table.itemCount} {table.itemCount === 1 ? 'item' : 'items'}
                {table.orders.length > 1 ? ` · latest ${table.latest}` : ''}
              </p>

              <ul className="mt-2 space-y-0.5">
                {table.items.slice(0, 4).map((item, index) => (
                  <li key={`${item.name}-${index}`} className="truncate text-[12.5px] text-gink-80">
                    <span className="tnum text-gink-46">{item.qty}×</span> {item.name}
                  </li>
                ))}
                {table.items.length > 4 && (
                  <li className="text-[11.5px] text-gink-46">+{table.items.length - 4} more</li>
                )}
              </ul>

              {table.note && (
                <p className="mt-2 line-clamp-2 text-[11.5px] leading-[1.5] text-gink-46">
                  “{table.note}”
                </p>
              )}

              {isRejecting ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" className={btn('danger', 'sm')} disabled={isBusy} onClick={() => id && reject(id)}>
                    Yes, not our table
                  </button>
                  <button type="button" className={btn('quiet', 'sm')} disabled={isBusy} onClick={() => setRejecting(null)}>
                    Keep it
                  </button>
                  <span className="basis-full text-[11.5px] leading-[1.45] text-gink-46">
                    This cancels the held orders and tells the guest at the table. Nothing has been cooked.
                  </span>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={btn('primary', 'sm')}
                    disabled={!canAct}
                    onClick={() => id && confirm(id)}
                  >
                    {isBusy ? 'Confirming…' : 'Confirm table'}
                  </button>
                  <button
                    type="button"
                    className={btn('quiet', 'sm')}
                    disabled={!canAct}
                    onClick={() => setRejecting(rowKey)}
                  >
                    Not our table
                  </button>
                </div>
              )}

              {!canConfirm && (
                <p className="mt-2 text-[11.5px] leading-[1.45] text-gink-46">
                  Only an owner, a manager or kitchen staff can confirm a table, and only on a
                  restaurant that can take orders.
                </p>
              )}
              {canConfirm && !id && (
                <p className="mt-2 text-[11.5px] leading-[1.45] text-gink-46">
                  This order is not tied to a table sitting, so it cannot be confirmed here.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {message && (
        <p
          role="status"
          className={[
            'px-4 py-2 text-[11.5px] font-medium',
            message.tone === 'error' ? 'text-[var(--p-due)]' : 'text-[var(--p-live)]',
          ].join(' ')}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
