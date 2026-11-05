'use client';

/**
 * The translator's review — original beside translated, per row.
 *
 * The owner picks हिन्दी or मराठी, generates the rows that have no fresh
 * translation (never one that is already current — the same "do not
 * overwrite" rule the description writer holds), edits what came back, and
 * saves what they accept. Saving is the approval: guests see a translation
 * only after this button has been pressed, and only while the dish it
 * describes has not changed since.
 */

import { useState, useTransition } from 'react';
import { SubmitButton } from '@/components/owner/SubmitButton';
import {
  generateTranslationsAction,
  saveTranslationsAction,
} from '@/app/(staff)/dashboard/menus/actions';
import {
  isFresh,
  type LanguageCode,
  type TranslationMap,
} from '@/lib/i18n/translations';

export type TranslateRowModel = {
  kind: 'item' | 'category';
  id: string;
  name: string;
  description: string;
  translations: TranslationMap;
};

type RowState = {
  /** The proposed translated name; '' = nothing proposed yet. */
  name: string;
  description: string;
  status: 'idle' | 'proposed' | 'accepted' | 'skipped' | 'failed';
  reason?: string;
};

const LANGUAGE_TABS: { code: LanguageCode; label: string }[] = [
  { code: 'hi', label: 'हिन्दी' },
  { code: 'mr', label: 'मराठी' },
];

export function TranslationPanel({ rows }: { rows: TranslateRowModel[] }) {
  const [language, setLanguage] = useState<LanguageCode>('hi');
  const [state, setState] = useState<Record<string, RowState>>({});
  const [busy, startTransition] = useTransition();

  /** Rows the writer may touch: missing or outdated. Fresh ones stay put. */
  const needsWork = (row: TranslateRowModel) => !isFresh(row.translations[language], row.name, row.description);

  const stateOf = (row: TranslateRowModel): RowState =>
    state[`${language}:${row.kind}:${row.id}`] ?? {
      name: '',
      description: '',
      status: 'idle',
    };

  const setStateOf = (row: TranslateRowModel, patch: Partial<RowState>) =>
    setState((current) => ({
      ...current,
      [`${language}:${row.kind}:${row.id}`]: { ...stateOf(row), ...patch },
    }));

  const generate = () => {
    const pending = rows.filter(needsWork);
    if (pending.length === 0 || busy) return;
    startTransition(async () => {
      const results = await generateTranslationsAction({
        language,
        targets: pending.map((row) => ({ id: row.id, kind: row.kind })),
      });
      const byId = new Map(results.map((result) => [result.id, result]));
      setState((current) => {
        const next = { ...current };
        for (const row of pending) {
          const result = byId.get(row.id);
          next[`${language}:${row.kind}:${row.id}`] = result
            ? result.ok
              ? { name: result.name, description: result.description, status: 'proposed' }
              : { name: '', description: '', status: 'failed', reason: result.reason }
            : { name: '', description: '', status: 'failed', reason: 'No answer came back for this one.' };
        }
        return next;
      });
    });
  };

  const accepted = rows
    .map((row) => ({ row, s: stateOf(row) }))
    .filter((entry) => entry.s.status === 'accepted');

  const freshCount = rows.filter((row) => !needsWork(row)).length;
  const staleCount = rows.length - freshCount;

  return (
    <section className="rounded-[var(--p-r-block)] border border-hair bg-card p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="m-0 text-[13px] font-semibold text-gink">Translate the menu</h2>
          <p className="m-0 mt-0.5 text-[11.5px] text-gink-46">
            {freshCount > 0 && `${freshCount} rows are current in this language. `}
            {staleCount > 0
              ? `${staleCount} ${staleCount === 1 ? 'row needs' : 'rows need'} translation.`
              : 'Nothing left to translate.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1" role="tablist" aria-label="Language">
            {LANGUAGE_TABS.map((tab) => (
              <button
                key={tab.code}
                type="button"
                role="tab"
                aria-selected={language === tab.code}
                onClick={() => setLanguage(tab.code)}
                className={`rounded-[var(--p-r-chip)] border px-2.5 py-1 text-[12.5px] transition-colors duration-150 ${
                  language === tab.code
                    ? 'border-[var(--p-accent)] text-gink'
                    : 'border-hair text-gink-46 hover:bg-gink-07 hover:text-gink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </span>
          <button
            type="button"
            onClick={generate}
            disabled={busy || staleCount === 0}
            className="rounded-[var(--p-r-chip)] border border-hair px-2.5 py-1 text-[12.5px] text-gink transition-colors duration-150 hover:bg-gink-07 disabled:opacity-45"
          >
            {busy ? 'Translating…' : '✨ Generate with AI'}
          </button>
        </div>
      </div>

      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => {
          const s = stateOf(row);
          const fresh = !needsWork(row);
          const existing = row.translations[language];
          return (
            <li key={`${row.kind}:${row.id}`} className="rounded-[var(--p-r-card)] border border-hair p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-medium text-gink">
                  {row.name}
                  {row.kind === 'category' && <span className="ml-1.5 text-[11.5px] text-gink-46">Category</span>}
                </span>
                {s.status === 'failed' ? (
                  <span className="text-[11.5px] text-gink-46">{s.reason}</span>
                ) : (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setStateOf(row, { status: 'accepted' })}
                      disabled={s.status === 'accepted'}
                      data-accept={`${row.kind}:${row.id}`}
                      className="rounded-[var(--p-r-chip)] border border-hair px-2 py-0.5 text-[11.5px] text-gink transition-colors duration-150 hover:bg-gink-07 disabled:border-[var(--p-accent)]"
                    >
                      {s.status === 'accepted' ? 'Accepted' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStateOf(row, { status: 'skipped' })}
                      disabled={s.status === 'skipped'}
                      data-skip={`${row.kind}:${row.id}`}
                      className="rounded-[var(--p-r-chip)] border border-hair px-2 py-0.5 text-[11.5px] text-gink-46 transition-colors duration-150 hover:bg-gink-07 disabled:opacity-45"
                    >
                      {s.status === 'skipped' ? 'Skipped' : 'Skip'}
                    </button>
                  </span>
                )}
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="m-0 text-[11.5px] text-gink-46">Original</p>
                  <p className="m-0 mt-0.5 text-[12.5px] text-gink">{row.name}</p>
                  {row.description !== '' && (
                    <p className="m-0 mt-0.5 text-[11.5px] text-gink-64">{row.description}</p>
                  )}
                </div>
                <div>
                  <p className="m-0 text-[11.5px] text-gink-46">
                    {fresh ? 'Current translation' : s.name === '' ? 'Needs translation' : 'Proposed'}
                  </p>
                  {s.status !== 'failed' && (
                    <>
                      <input
                        type="text"
                        maxLength={120}
                        aria-label={`Translated name for ${row.name}`}
                        placeholder={fresh && existing ? existing.name : 'Name'}
                        value={s.name}
                        onChange={(event) => setStateOf(row, { name: event.target.value })}
                        className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-card px-2.5 py-1.5 text-[12.5px] text-gink"
                      />
                      <textarea
                        rows={2}
                        maxLength={300}
                        aria-label={`Translated description for ${row.name}`}
                        placeholder={fresh && existing ? existing.description : 'Description'}
                        value={s.description}
                        onChange={(event) => setStateOf(row, { description: event.target.value })}
                        className="mt-1 w-full rounded-[var(--p-r-control)] border border-hair bg-card px-2.5 py-1.5 text-[12.5px] text-gink"
                      />
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <form action={saveTranslationsAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="language" value={language} />
        <input
          type="hidden"
          name="rows"
          value={JSON.stringify(
            accepted.map(({ row, s }) => ({
              id: row.id,
              kind: row.kind,
              name: s.name,
              description: s.description,
            }))
          )}
        />
        <SubmitButton pendingLabel="Saving…" disabled={accepted.length === 0}>
          Save {accepted.length} accepted
        </SubmitButton>
        <span className="text-[11.5px] text-gink-46">
          Saved translations go live with the menu. Guests see only what is saved here.
        </span>
      </form>
    </section>
  );
}

/** Exported for tests: the panel's freshness rule, without the markup. */
export function rowNeedsWork(row: TranslateRowModel, language: LanguageCode): boolean {
  return !isFresh(row.translations[language], row.name, row.description);
}
