'use client';

/**
 * "Enhance menu with AI" — the bulk door of the description writer.
 *
 * The server passes the dishes missing a description; this panel writes
 * proposals for them, shows every one for review, and saves only what the
 * owner accepts. A dish the writer could not describe honestly is listed
 * with its reason instead of a guess. Nothing is saved by generating — the
 * save button is the owner's accept-all-the-checked decision.
 */

import { useState, useTransition } from 'react';
import { SubmitButton } from '@/components/owner/SubmitButton';
import {
  generateDescriptionsAction,
  saveDescriptionsAction,
} from '@/app/(staff)/dashboard/menus/actions';

type Row = {
  id: string;
  name: string;
  /** The proposal the owner edits. */
  text: string;
  status: 'pending' | 'proposed' | 'failed' | 'accepted' | 'skipped';
  reason?: string;
};

export function EnhancePanel({ items }: { items: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => items.map((item) => ({ ...item, text: '', status: 'pending' as const })));
  const [busy, startTransition] = useTransition();

  const accepted = rows.filter((row) => row.status === 'accepted');
  const done = rows.every((row) => row.status !== 'pending');

  const generate = () => {
    setOpen(true);
    if (done || busy) return;
    startTransition(async () => {
      const results = await generateDescriptionsAction(rows.map((row) => ({ id: row.id })));
      const byId = new Map(results.map((result) => [result.id, result]));
      setRows((current) =>
        current.map((row) => {
          const result = byId.get(row.id);
          if (!result) return { ...row, status: 'failed' as const, reason: 'No answer came back for this one.' };
          return result.ok
            ? { ...row, status: 'proposed' as const, text: result.description }
            : { ...row, status: 'failed' as const, reason: result.reason };
        })
      );
    });
  };

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <section className="mb-3 rounded-[var(--p-r-block)] border border-hair bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-[13px] font-semibold text-gink">Enhance menu with AI</h2>
          <p className="m-0 mt-0.5 text-[11.5px] text-gink-46">
            {items.length} {items.length === 1 ? 'dish is' : 'dishes are'} missing a description. Nothing saves until you
            accept it.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={generate}
            className="rounded-[var(--p-r-chip)] border border-hair px-2.5 py-1 text-[12.5px] text-gink transition-colors duration-150 hover:bg-gink-07"
          >
            ✨ Write descriptions
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3">
          {busy && (
            <p className="m-0 mb-2 text-[12.5px] text-gink-46" role="status">
              Writing…
            </p>
          )}

          {done && !busy && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {rows.map((row) => (
                <li key={row.id} className="rounded-[var(--p-r-card)] border border-hair p-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-gink">{row.name}</span>
                    {row.status === 'failed' ? (
                      <span className="text-[11.5px] text-gink-46">{row.reason}</span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setRow(row.id, { status: 'accepted' })}
                          disabled={row.status === 'accepted'}
                          data-accept={row.id}
                          className="rounded-[var(--p-r-chip)] border border-hair px-2 py-0.5 text-[11.5px] text-gink transition-colors duration-150 hover:bg-gink-07 disabled:border-[var(--p-accent)] disabled:text-gink"
                        >
                          {row.status === 'accepted' ? 'Accepted' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRow(row.id, { status: 'skipped' })}
                          disabled={row.status === 'skipped'}
                          data-skip={row.id}
                          className="rounded-[var(--p-r-chip)] border border-hair px-2 py-0.5 text-[11.5px] text-gink-46 transition-colors duration-150 hover:bg-gink-07 disabled:opacity-45"
                        >
                          {row.status === 'skipped' ? 'Skipped' : 'Skip'}
                        </button>
                      </span>
                    )}
                  </div>
                  {row.status !== 'failed' && (
                    <textarea
                      className="mt-2 w-full rounded-[var(--p-r-control)] border border-hair bg-card px-3 py-2 text-[12.5px] text-gink"
                      rows={2}
                      maxLength={300}
                      aria-label={`Description for ${row.name}`}
                      value={row.text}
                      onChange={(event) => setRow(row.id, { text: event.target.value })}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {done && !busy && (
            <form action={saveDescriptionsAction} className="mt-3 flex items-center gap-2">
              <input type="hidden" name="rows" value={JSON.stringify(accepted.map((row) => ({ id: row.id, description: row.text })))} />
              <SubmitButton pendingLabel="Saving…" disabled={accepted.length === 0}>
                Save {accepted.length} accepted
              </SubmitButton>
              <span className="text-[11.5px] text-gink-46">
                {rows.filter((row) => row.status === 'skipped').length > 0 &&
                  `${rows.filter((row) => row.status === 'skipped').length} skipped · `}
                {rows.filter((row) => row.status === 'failed').length > 0 &&
                  `${rows.filter((row) => row.status === 'failed').length} could not be written`}
              </span>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
