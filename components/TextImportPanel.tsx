'use client';

import { useState } from 'react';
import { parseMenuText, MAX_IMPORT_TEXT } from '@/lib/menus/bulk-parse';
import { Card, btn, inputClass } from '@/components/owner/chrome';
import type { PhotoDraft } from '@/components/PhotoImportPanel';

const EXAMPLE = 'STARTERS\nPaneer Tikka 320';

/** Deterministic, no-AI path for owners who have a text menu or no vision service. */
export function TextImportPanel({
  canWrite,
  onDraftChange,
}: {
  canWrite: boolean;
  onDraftChange: (draft: PhotoDraft | null) => void;
}) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseMenuText> | null>(null);
  const [error, setError] = useState('');

  function read() {
    setError('');
    const draft = parseMenuText(text);
    const itemCount = draft.categories.reduce((sum, category) => sum + category.items.length, 0);
    if (itemCount === 0) {
      setParsed(null);
      onDraftChange(null);
      setError('No priced dishes found. Add a section heading and a dish with its printed price.');
      return;
    }

    setParsed(draft);
    onDraftChange({
      payload: {
        categories: draft.categories.map((category) => ({
          name: category.name,
          items: category.items.map((item) => ({
            name: item.name,
            pricePaise: item.pricePaise,
            description: item.description,
            isVeg: item.isVeg,
            ...(item.variants?.length ? { variants: item.variants } : {}),
          })),
        })),
      },
      missingPrice: false,
      crops: [],
      file: null,
    });
  }

  const itemCount = parsed?.categories.reduce((sum, category) => sum + category.items.length, 0) ?? 0;

  return (
    <Card className="mt-4">
      <div className="border-b border-hair px-4 py-3 sm:px-5">
        <h2 className="text-[13px] font-semibold text-gink">Paste a menu</h2>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-46">
          Text import works without a vision service. Prices are read as printed; unclear lines are shown for review.
        </p>
      </div>
      <div className="grid gap-3 px-4 py-4 sm:px-5">
        <label className="grid gap-1.5 text-[12px] font-medium text-gink-64">
          Menu text
          <textarea
            aria-label="Menu text"
            className={`${inputClass} min-h-36 resize-y font-mono text-[12.5px]!`}
            maxLength={MAX_IMPORT_TEXT}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setParsed(null);
              onDraftChange(null);
            }}
            placeholder={'STARTERS\nPaneer Tikka 320\nDal Makhani 280'}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btn('solid', 'sm')}
            disabled={!canWrite || text.trim() === ''}
            onClick={read}
          >
            Read the menu
          </button>
          <button
            type="button"
            className={btn('quiet', 'sm')}
            disabled={!canWrite}
            onClick={() => {
              setText(EXAMPLE);
              setParsed(null);
              setError('');
              onDraftChange(null);
            }}
          >
            Paste an example
          </button>
          {parsed && <p role="status" className="m-0 text-[12px] text-gink-64">{itemCount} priced dish{itemCount === 1 ? '' : 'es'} ready to save as a draft.</p>}
        </div>
        {error && <p role="alert" className="m-0 text-[12.5px] text-[var(--p-due)]">{error}</p>}
        {parsed?.issues.length ? (
          <div role="status" className="grid gap-1 text-[12px] text-gink-64">
            <strong className="font-semibold text-gink">Check these lines; they were not imported.</strong>
            {parsed.issues.map((issue, index) => <p key={`${index}-${issue.line}`} className="m-0">{issue.line}: {issue.reason}</p>)}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
