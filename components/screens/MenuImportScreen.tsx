'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SignInPrompt } from '@/components/SignInPrompt';
import { VegMark } from '@/components/ui';
import {
  parseMenuFileAction,
  previewMenuImportAction,
  type ImportPreview,
} from '@/app/(staff)/dashboard/menus/import-actions';
import { createImportPairAction } from '@/app/(staff)/dashboard/menus/brand-actions';
import { BrandReview, brandStateToDraft, type BrandReviewState } from '@/components/screens/BrandReview';
import { PhotoImportPanel } from '@/components/PhotoImportPanel';
import { draftItemCount, MAX_IMPORT_TEXT } from '@/lib/menu-import';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import type { OutletBar } from '@/lib/outlets';
import {
  Card,
  OwnerPage,
  PageHead,
  Segmented,
  Tag,
  btn,
  textareaClass,
} from '@/components/owner/chrome';

const SAMPLE = `STARTERS
Paneer Tikka 320
Chicken 65 360
Veg Manchurian 260

MAIN COURSE
Dal Makhani 280
Butter Chicken 420
Jeera Rice 180`;

/**
 * Import a menu that already exists elsewhere.
 *
 * Two steps, and the first one writes nothing. The review is not decoration:
 * it is where the owner sees that "Paneer Tikka 320" became a ₹320 dish, that
 * four lines were skipped, and that two dishes were guessed non-veg from
 * their names. Undo after an import is a delete menu; undo before one is a
 * glance.
 */
export function MenuImportScreen({
  outlet,
  role,
  blocked,
  visionEnabled = false,
}: {
  outlet?: OutletBar | null;
  /** owner/manager can write; anyone else can read this screen and not save. */
  role?: string;
  blocked?: 'signed-out' | 'no-membership';
  /**
   * Does this deployment have a vision key?
   *
   * Passed from the server because it is an environment fact. When it is false
   * the photo path cannot work at all: there is no model to read the picture.
   * The screen used to offer it anyway, as the DEFAULT tab, so the first thing
   * an owner tried on this page was the one thing guaranteed to fail. A path
   * that cannot succeed is not an option.
   */
  visionEnabled?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [writing, startWriting] = useTransition();

  const canWrite = !blocked && (role === 'owner' || role === 'manager');

  /*
   * Which input the owner is using.
   *
   * Photo first when there is a model to read it: a restaurant with a printed
   * card already has the thing this needs, and typing it out is the long way
   * round. With no vision key the photo path is not a slower option, it is an
   * impossible one, so the screen starts on text and does not offer the tab.
   */
  const [mode, setMode] = useState<'photo' | 'file' | 'text'>(visionEnabled ? 'photo' : 'text');

  /* The stable import identifier: the menu draft and the brand draft share
     it, and a repeated Create finds the same pair instead of doubling it. */
  const [importId] = useState(() => crypto.randomUUID());
  const [menuFile, setMenuFile] = useState<File | null>(null);
  const [brandState, setBrandState] = useState<BrandReviewState | null>(null);

  function readMenu() {
    setError(null);
    startReading(async () => {
      try {
        const result = await previewMenuImportAction(text);
        setPreview(result);
        setDropped(new Set());
        if (!result.ok) setError(result.error);
      } catch {
        // A rejected server action must not leave the Read button stuck.
        setError('Something went wrong reading the text. Try again.');
      }
    });
  }

  function readSpreadsheet(picked: File | null) {
    if (!picked) return;
    setError(null);
    startReading(async () => {
      try {
        const data = new FormData();
        data.set('file', picked);
        const result = await parseMenuFileAction(data);
        setPreview(result);
        setDropped(new Set());
        if (!result.ok) setError(result.error);
      } catch {
        setError('Something went wrong reading that file. Try again.');
      }
    });
  }

  function createMenu() {
    if (!preview?.ok) return;
    setError(null);

    const kept = {
      categories: preview.draft.categories.filter((_, index) => !dropped.has(index)),
      importId,
    };

    startWriting(async () => {
      try {
        // The pair: menu draft AND brand draft, one import id. A failure in the
        // brand half rolls the menu half back (createImportPairAction).
        const brand = brandState ? brandStateToDraft(brandState, importId) : null;
        const result = await createImportPairAction({ menu: kept, brand: brand ?? { importId } });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push('/dashboard/menus');
      } catch {
        // A thrown server action must not leave the Import button stuck —
        // blocked buttons with a draft that never arrived is the bug class
        // this catch prevents.
        setError('Something went wrong saving the menu. Try again — nothing was changed.');
      }
    });
  }

  const draft = preview?.ok ? preview.draft : null;
  const keptCount = draft
    ? draft.categories
        .filter((_, index) => !dropped.has(index))
        .reduce((sum, category) => sum + category.items.length, 0)
    : 0;

  return (
    <OwnerPage active="import" outlet={outlet}>
      <PageHead
        kicker="Menu · import"
        title="Bring in a menu you already have"
        meta={
          visionEnabled
            ? 'Photograph your printed menu and we read the dishes, prices and pictures for you to check. Or upload a spreadsheet, or paste the text. Nothing is saved until you approve it.'
            : 'Upload a spreadsheet or paste your menu’s text and we read the dishes and prices for you to check. Nothing is saved until you approve it.'
        }
        actions={
          <Link href="/dashboard/menus" className={btn('ghost', 'sm')}>
            Back to the menu editor
          </Link>
        }
      />

      {/* Three inputs, one result. A segmented control rather than separate
          screens, so the owner never has to guess which page to be on. The
          photo tab appears only when there is a vision key: "Photo of your
          menu" on a deployment that cannot read one is a tab that can only
          disappoint. */}
      {!blocked && (
        <div className="mb-4">
          <Segmented
            label="How to import"
            value={mode}
            onChange={(next) => setMode(next as 'photo' | 'file' | 'text')}
            options={[
              ...(visionEnabled
                ? [
                    {
                      value: 'photo',
                      label: 'Photo of your menu',
                      data: { 'data-import-tab': mode === 'photo' ? 'on' : 'off' },
                    },
                  ]
                : []),
              {
                value: 'file',
                label: 'Spreadsheet file',
                data: { 'data-import-tab': mode === 'file' ? 'on' : 'off' },
              },
              { value: 'text', label: 'Paste the text', data: { 'data-import-tab': mode === 'text' ? 'on' : 'off' } },
            ]}
          />
        </div>
      )}

      {/* The progress strip: where the owner is, in one line. Derived from
          real state only — the save step lights up while the save runs, and
          nothing claims a step that has not happened. */}
      {!blocked && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5" data-import-steps>
          {['Add your menu', 'Check dishes & brand', 'Save the draft'].map((label, index) => {
            const position = writing ? 2 : preview?.ok || menuFile ? 1 : 0;
            const state = index < position ? 'done' : index === position ? 'active' : 'todo';
            return (
              <span
                key={label}
                data-step={state}
                className={[
                  'rounded-full border px-2.5 py-1 text-[11.5px]',
                  state === 'active'
                    ? 'border-gink font-semibold text-gink'
                    : state === 'done'
                      ? 'border-gink bg-gink text-onink'
                      : 'border-hair text-gink-46',
                ].join(' ')}
              >
                {index + 1} · {label}
              </span>
            );
          })}
        </div>
      )}

      {!blocked && !visionEnabled && (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[var(--p-r-block)] border border-hair bg-card px-4 py-3">
          <Tag tone="neutral">Paste the text</Tag>
          <p className="m-0 flex-1 text-[12.5px] leading-[1.5] text-gink-64">
            Reading a photograph needs a vision model, and this deployment does not have one
            configured. Paste the menu&rsquo;s text instead &mdash; it is parsed by rules, and you check
            every line before anything is saved.
          </p>
        </div>
      )}

      {mode === 'photo' && visionEnabled && !blocked && (
        <PhotoImportPanel
          canWrite={canWrite}
          onFileChange={setMenuFile}
          importId={importId}
          createDraft={(menu) =>
            createImportPairAction({
              menu,
              brand: brandState ? brandStateToDraft(brandState, importId) : { importId },
            })
          }
        />
      )}

      {blocked && <SignInPrompt reason={blocked} screen="menu import" />}

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-[var(--p-r-block)] border border-[var(--p-due)]/30 bg-[var(--p-due)]/8 px-4 py-3"
        >
          <strong className="text-[12.5px] text-[var(--p-due)]">Nothing was imported.</strong>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-64">{error}</p>
        </div>
      )}

      {mode === 'file' && !preview?.ok && !blocked && (
        <Card>
          <div className="border-b border-hair px-4 py-3 sm:px-5">
            <h2 className="text-[13px] font-semibold text-gink">Upload a spreadsheet</h2>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-46">
              A CSV or Excel file with one dish per row. A name column and a price column are
              required; category, description and veg are used when the file has them. Nothing is
              saved until you check the result.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 px-4 py-4 sm:px-5">
            <label className={`${btn('solid', 'sm')} relative cursor-pointer overflow-hidden`}>
              {reading ? 'Reading the file…' : 'Choose a CSV or Excel file'}
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                disabled={reading}
                onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  readSpreadsheet(picked);
                }}
              />
            </label>
            <span className="text-[11.5px] text-gink-46">CSV or .xlsx, up to 5 MB.</span>
          </div>
        </Card>
      )}

      {mode === 'text' && !preview?.ok && !blocked && (
        <Card>
          <div className="border-b border-hair px-4 py-3 sm:px-5">
            <h2 className="text-[13px] font-semibold text-gink">The menu text</h2>
            <p className="mt-1 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
              Section headings on their own line, then the dishes. Prices can be written as 320, ₹320,
              320/- or 1,200.
            </p>
          </div>

          <div className="px-4 py-4 sm:px-5">
            <label htmlFor="menu-import-text" className="mb-1.5 block text-[11.5px] font-medium text-gink-64">
              Paste here
            </label>
            <textarea
              id="menu-import-text"
              className={`${textareaClass} min-h-[280px] font-mono text-[12.5px]!`}
              name="menuText"
              rows={14}
              maxLength={MAX_IMPORT_TEXT}
              placeholder={SAMPLE}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="mt-1.5 text-[11.5px] leading-[1.45] text-gink-46">
              {text.length.toLocaleString('en-IN')} of {MAX_IMPORT_TEXT.toLocaleString('en-IN')}{' '}
              characters. A photograph of a menu cannot be pasted — type or copy the text.
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className={btn('ghost', 'sm')}
                onClick={() => setText(SAMPLE)}
                disabled={reading || writing}
              >
                Use the example
              </button>
              <button
                type="button"
                className={btn('solid', 'sm')}
                onClick={readMenu}
                disabled={reading || writing}
              >
                {reading ? 'Reading…' : 'Read the menu'}
              </button>
            </div>

            <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
              Reading a menu with a language model is optional and off unless this deployment has a key
              configured. When it is off, the text is read by rules: a line with a price is a dish, a
              short line without one is a section. Either way you see the result before anything is
              written.
            </p>
          </div>
        </Card>
      )}

      {draft && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hair px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-[13px] font-semibold text-gink">Check before importing</h2>
              <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-46">
                {draft.categories.length} section{draft.categories.length === 1 ? '' : 's'} ·{' '}
                {draftItemCount(draft)} dish{draftItemCount(draft) === 1 ? '' : 'es'}. Untick a section
                to leave it out.
              </p>
            </div>
            {preview?.ok && preview.note && (
              <span className="text-[11.5px] text-gink-46">{preview.note}</span>
            )}
          </div>

          <div className="flex flex-col gap-2.5 px-4 py-4 sm:px-5">
            {draft.categories.map((category, index) => {
              const kept = !dropped.has(index);
              return (
                <div
                  key={`${category.name}-${index}`}
                  data-kept={kept ? 'true' : 'false'}
                  className={[
                    'rounded-[var(--p-r-block)] border px-3.5 py-3 transition-colors',
                    kept ? 'border-hair bg-paper-deep/60' : 'border-hair bg-paper-deep opacity-55',
                  ].join(' ')}
                >
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={kept}
                      className="size-4 shrink-0 accent-[var(--p-accent)]"
                      onChange={(event) => {
                        const next = new Set(dropped);
                        if (event.target.checked) next.delete(index);
                        else next.add(index);
                        setDropped(next);
                      }}
                    />
                    <strong className="text-[12.5px] font-semibold text-gink">{category.name}</strong>
                    <span className="text-[11.5px] text-gink-46">
                      {category.items.length} dish{category.items.length === 1 ? '' : 'es'}
                    </span>
                  </label>

                  <ul className="m-0 mt-2 grid list-none gap-1 p-0 sm:grid-cols-2">
                    {category.items.map((item, itemIndex) => (
                      <li
                        key={`${item.name}-${itemIndex}`}
                        className="flex items-baseline justify-between gap-2 text-[12.5px] text-gink-64"
                      >
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <VegMark veg={item.isVeg} />
                          <span className="truncate">{item.name}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-gink">
                          {inr(paiseToRupees(item.pricePaise))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            {draft.issues.length > 0 && (
              <div className="rounded-[var(--p-r-block)] border border-[var(--p-due)]/30 bg-[var(--p-due)]/8 px-3.5 py-3">
                <strong className="text-[12.5px] font-semibold text-gink">
                  {draft.issues.length} line(s) were not imported.
                </strong>{' '}
                <span className="text-[11.5px] leading-[1.5] text-gink-64">
                  Fix these in your own document and paste again, or add them by hand afterwards.
                </span>
                <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                  {draft.issues.slice(0, 12).map((issue, index) => (
                    <li key={index} className="text-[11.5px] leading-[1.45] text-gink-64">
                      <code className="rounded bg-card px-1 py-0.5 text-[11.5px] text-gink">
                        {issue.line}
                      </code>{' '}
                      — {issue.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {draft.duplicates > 0 && (
              <p className="m-0 text-[11.5px] leading-[1.5] text-gink-46">
                {draft.duplicates} duplicate line{draft.duplicates === 1 ? ' was' : 's were'} dropped
                because the same dish with the same price appeared twice.
              </p>
            )}

            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[var(--p-r-block)] border border-hair bg-card px-3.5 py-3">
              <Tag tone="neutral">Guess</Tag>
              <p className="m-0 flex-1 text-[11.5px] leading-[1.5] text-gink-64">
                <strong className="font-semibold text-gink">
                  Only what the menu marks is marked.
                </strong>{' '}
                Anything named chicken, mutton, fish, prawn or egg is marked non-veg from its name;
                everything else arrives unmarked until you set it above. A wrong mark is a real
                problem for a guest, not a detail.
              </p>
            </div>

            {!canWrite ? (
              <p className="m-0 text-[11.5px] leading-[1.5] text-gink-46">
                Only an owner or manager can add a menu. You are signed in as {role ?? 'staff'}.
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  className={btn('ghost', 'sm')}
                  onClick={() => {
                    setPreview(null);
                    setError(null);
                  }}
                  disabled={writing}
                >
                  Start over
                </button>
                <button
                  type="button"
                  className={btn('solid', 'sm')}
                  onClick={createMenu}
                  disabled={writing || reading || keptCount === 0}
                >
                  {writing
                    ? 'Importing…'
                    : `Import ${keptCount} dish${keptCount === 1 ? '' : 'es'} as a draft menu`}
                </button>
              </div>
            )}

            <p className="m-0 text-[11.5px] leading-[1.5] text-gink-46">
              The import becomes a new <strong className="text-gink">draft</strong> menu called
              &quot;Imported menu&quot;, so your live menu is not touched. Review it in the editor, then
              publish when it is right.
            </p>
          </div>
        </Card>
      )}

      {/* The brand half of the import. Independent extraction, independent
          review — one Create writes both drafts. */}
      <BrandReview
        enabled={visionEnabled}
        canWrite={canWrite}
        existingName={outlet?.outlets.find((o) => o.id === outlet.activeId)?.name ?? ''}
        file={menuFile}
        onStateChange={(state) => setBrandState((current) => (current === state ? current : state))}
      />
    </OwnerPage>
  );
}
