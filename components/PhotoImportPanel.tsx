'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { VegMark } from '@/components/ui';
import {
  extractMenuFromPhotoAction,
  type PhotoPreview,
} from '@/app/(staff)/dashboard/menus/import-actions';
import { uploadBrandAssetAction } from '@/app/(staff)/dashboard/menus/brand-actions';
import { MAX_MENU_PHOTO_BYTES, type VisionCategory } from '@/lib/ai/menu-vision';
import { Card, btn, inputClass } from '@/components/owner/chrome';

/**
 * Photograph a menu, read it, check it, save it as a draft.
 *
 * THE THREE STEPS ARE THE SCREEN
 *
 *   pick   -> a preview of what you are about to send, with Retake
 *   read   -> one button; the model never sees the file until it is pressed
 *   review -> the draft, editable, with the uncertain rows marked
 *
 * WHY THE REVIEW IS A FORM RATHER THAN A TABLE OF TEXT
 *
 * Because it is the only place a bad read can be caught. An empty price field
 * with an amber note is a question; a number that looks plausible is an
 * answer nobody checks. Items whose price could not be read start EMPTY and
 * cannot be saved until the owner types one or removes the dish.
 */

type Editable = {
  name: string;
  price: string;
  isVeg: boolean | null;
  flags: string[];
  photo: { page: number; x: number; y: number; w: number; h: number } | null;
};

type EditableCategory = { name: string; items: Editable[] };

/** The menu half of the one Create — same shape the text path sends. */
export type MenuDraftPayload = {
  categories: {
    name: string;
    items: { name: string; pricePaise: number; description: string | null; isVeg: boolean | null }[];
  }[];
  importId?: string;
};

/**
 * What the parent's one save needs from the photo path: the draft, the
 * dish-photo boxes to crop after the menu exists, and the file to crop from.
 */
export type PhotoDraft = {
  payload: MenuDraftPayload;
  /** A dish still has no price — the save must refuse and say so. */
  missingPrice: boolean;
  /** Printed dish photos, positioned in the draft's own category/item grid. */
  crops: { categoryIndex: number; itemIndex: number; box: { page: number; x: number; y: number; w: number; h: number } }[];
  file: File | null;
};

const FLAG_TEXT: Record<string, string> = {
  'price-unclear': 'Price unclear — check the photo',
  'no-price-printed': 'No price in the photo',
  'name-unclear': 'Name unclear',
  'veg-unclear': 'No veg mark',
};

export function PhotoImportPanel({
  canWrite,
  onFileChange,
  onDraftChange,
}: {
  canWrite: boolean;
  /**
   * The chosen file, lifted to the parent so the Brand Review can read the
   * same menu photo for its own extraction ("the same menu image may be used
   * for both"). Purely informational — this panel keeps owning the import.
   */
  onFileChange?: (file: File | null) => void;
  /** Lifts the checked draft to the parent's one save. */
  onDraftChange?: (draft: PhotoDraft | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'reading' | 'review' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [model, setModel] = useState<string>('');
  const [categories, setCategories] = useState<EditableCategory[]>([]);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  /** The drop zone says "let go here" while a file is dragged over it. */
  const [dragOver, setDragOver] = useState(false);

  const [working, startWork] = useTransition();

  function reset() {
    setFile(null);
    onFileChange?.(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setStatus('idle');
    setCategories([]);
    setNotes([]);
    setError(null);
    setNotice(null);
    setDropped(new Set());
    if (inputRef.current) inputRef.current.value = '';
  }

  function pick(picked: File | null) {
    setError(null);
    setNotice(null);
    if (!picked) return;

    if (picked.size > MAX_MENU_PHOTO_BYTES) {
      setError(`That file is ${(picked.size / (1024 * 1024)).toFixed(1)} MB. The limit is 8 MB.`);
      return;
    }

    setFile(picked);
    onFileChange?.(picked);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    // A PDF has no thumbnail; the <img> would show a broken icon, so only an
    // image gets a preview.
    setPreviewUrl(picked.type === 'application/pdf' ? null : URL.createObjectURL(picked));
    setStatus('idle');
    setCategories([]);

    // Keep the original from the moment it is chosen: later corrections read
    // from this file, and a read that fails must not lose the owner's only
    // copy. The backup never blocks the import -- it is stored in the private
    // source bucket, and a failure is announced rather than silent.
    const source = new FormData();
    source.set('kind', 'menu-photo');
    source.set('file', picked);
    void uploadBrandAssetAction(source).then((result) => {
      if (!result.ok) {
        setNotice('The original photo could not be saved for later review. The import still works.');
      }
    });
  }

  function read() {
    if (!file) {
      setError('Choose a photo of your menu first.');
      return;
    }
    setError(null);
    setNotice(null);
    setStatus('reading');

    startWork(async () => {
      try {
        const data = new FormData();
        data.set('photo', file);
        const result: PhotoPreview = await extractMenuFromPhotoAction(data);

        if (!result.ok) {
          setError(result.error);
          setStatus('idle');
          return;
        }

        setNotes(result.draft.notes);
        setModel(result.draft.model);
        setCategories(
          result.draft.categories.map((category: VisionCategory) => ({
            name: category.name,
            items: category.items.map((item) => ({
              name: item.name,
              // Empty, not zero: a zero would be saved as ₹0 and the dish would
              // appear free on the menu.
              price: item.pricePaise === null ? '' : String(Math.round(item.pricePaise / 100)),
              isVeg: item.isVeg,
              flags: item.flags,
              photo: item.photo,
            })),
          }))
        );
        setStatus('review');
      } catch {
        // A rejected server action must not leave the panel stuck in
        // 'reading' — the Read button has to come back so the owner can retry.
        setError('Something went wrong reading that photo. Try again.');
        setStatus('idle');
      }
    });
  }

  function editPrice(ci: number, ii: number, value: string) {
    setCategories((current) =>
      current.map((category, c) =>
        c !== ci
          ? category
          : {
              ...category,
              items: category.items.map((item, i) => (i !== ii ? item : { ...item, price: value })),
            }
      )
    );
  }

  function toggleVeg(ci: number, ii: number) {
    setCategories((current) =>
      current.map((category, c) =>
        c !== ci
          ? category
          : {
              ...category,
              items: category.items.map((item, i) =>
                i !== ii
                  ? item
                  : {
                      ...item,
                      // Three states cycle: veg -> non-veg -> unmarked -> veg.
                      isVeg: item.isVeg === true ? false : item.isVeg === false ? null : true,
                    }
              ),
            }
      )
    );
  }

  function drop(ci: number, ii: number) {
    const key = `${ci}:${ii}`;
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const kept = categories.map((category, ci) => ({
    ...category,
    items: category.items.filter((_, ii) => !dropped.has(`${ci}:${ii}`)),
  }));

  const keptCount = kept.reduce((n, c) => n + c.items.length, 0);

  /* ---------------------------------------------------------------- lift */

  /*
   * The panel owns reading and checking; the SAVING lives in the parent,
   * below the brand review, so the menu and the brand go in with one
   * button. What crosses is exactly what the save needs and nothing else:
   * the draft, the dish-photo boxes to crop afterwards, and the file to
   * crop from.
   */
  useEffect(() => {
    if (!onDraftChange) return;
    if (status !== 'review' || categories.length === 0) {
      onDraftChange(null);
      return;
    }

    const keptNonEmpty = categories
      .map((category, categoryIndex) => ({
        name: category.name,
        items: category.items
          .map((item, itemIndex) => ({ item, isDropped: dropped.has(`${categoryIndex}:${itemIndex}`) }))
          .filter((entry) => !entry.isDropped)
          .map((entry) => entry.item),
      }))
      .filter((category) => category.items.length > 0);

    const payload: MenuDraftPayload = {
      categories: keptNonEmpty.map((category) => ({
        name: category.name,
        items: category.items.map((item) => ({
          name: item.name,
          // Rupees -> paise at the boundary, rounded the same way the rest
          // of the product does it.
          pricePaise: Math.round(Number(item.price.replace(/[^\d.]/g, '')) * 100),
          description: null as string | null,
          isVeg: item.isVeg,
        })),
      })),
    };

    const crops: PhotoDraft['crops'] = [];
    keptNonEmpty.forEach((category, categoryIndex) => {
      category.items.forEach((item, itemIndex) => {
        if (item.photo) crops.push({ categoryIndex, itemIndex, box: item.photo });
      });
    });

    onDraftChange({
      payload,
      missingPrice: keptNonEmpty.some((category) =>
        category.items.some((item) => item.price.trim() === ''),
      ),
      crops,
      file,
    });
  }, [status, categories, dropped, file, onDraftChange]);

  if (!canWrite) {
    return (
      <div className="rounded-[12px] border border-hair bg-paper-deep px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
        <strong className="font-semibold text-gink">Read-only for your role.</strong> An owner or
        manager can import a menu.
      </div>
    );
  }

  return (
    <div data-photo-import className="flex flex-col gap-4">
      {/* --------------------------------------------------------------- pick */}
      <Card>
        <div
          className="px-4 py-4 sm:px-5"
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            pick(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <div
            className={[
              'flex flex-col items-center gap-3 rounded-[14px] border-2 border-dashed px-4 py-8 text-center transition-colors duration-150',
              dragOver ? 'border-plum bg-plum-soft' : 'border-hair',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className="grid size-12 place-items-center rounded-full bg-plum-soft text-plum"
            >
              <svg viewBox="0 0 24 24" fill="none" className="size-5">
                <path
                  d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 15v2.5A2.5 2.5 0 007.5 20h9a2.5 2.5 0 002.5-2.5V15"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div>
              <h2 className="m-0 text-[17px] font-semibold text-gink">Drop your menu here</h2>
              <p className="mt-1 mb-0 text-[12.5px] text-gink-46">or choose how you want to add it</p>
            </div>

            {/* One way in, by the owner's call: a photo of the printed menu.
                The card reads selected because it is the only method. */}
            <div className="flex w-full max-w-[280px] items-center gap-2.5 rounded-[12px] border border-plum bg-plum-soft px-3.5 py-2.5 text-left">
              <span aria-hidden="true" className="shrink-0 text-plum">
                <svg viewBox="0 0 20 20" fill="none" className="size-[18px]">
                  <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="7.5" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.3" />
                  <path
                    d="M2.5 13.5L7 10l3.5 2.5 3-2 4 3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-semibold text-gink">Photo / PDF</p>
                <p className="m-0 text-[11.5px] text-gink-64">Scan or upload your printed menu</p>
              </div>
              <span
                aria-hidden="true"
                className="grid size-5 shrink-0 place-items-center rounded-full bg-plum text-onink"
              >
                <svg viewBox="0 0 16 16" fill="none" className="size-3">
                  <path
                    d="M3 8.5L6.5 12L13 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>

            <label className={`${btn('primary')} relative cursor-pointer overflow-hidden`}>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                /* `capture` opens the camera on a phone and is ignored on a
                   desktop, which is exactly the behaviour wanted: one control,
                   right on both. */
                capture="environment"
                onChange={(event) => pick(event.target.files?.[0] ?? null)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <span>{file ? 'Choose another' : 'Choose File'}</span>
            </label>
          </div>

          {/* What was chosen, when one is: exactly what will be read. */}
          {file && (
            <div className="mt-3 flex items-center gap-3">
              {/* A plain <img>, not next/image: this is a blob: URL for a file
                  that only exists in this tab, which the optimiser cannot
                  fetch. */}
              <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-hair bg-paper-deep">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="The menu you are about to read"
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="px-2 text-center text-[10.5px] leading-[1.4] text-gink-46">
                    PDF
                    <br />
                    <span className="break-all">{file.name.slice(0, 18)}</span>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[12.5px] font-medium text-gink">{file.name}</p>
                <button type="button" className={`${btn('quiet', 'sm')} mt-1`} onClick={reset}>
                  Clear
                </button>
              </div>
            </div>
          )}

          <p className="mt-3 mb-0 text-center text-[10.5px] text-gink-46">
            JPG, PNG, WebP or PDF · Up to 8 MB · PDF max 3 pages
          </p>
        </div>
      </Card>

      {/* --------------------------------------------------------------- read */}
      {file && status !== 'review' && (
        <Card>
          <div className="border-b border-hair px-4 py-3 sm:px-5">
            <h2 className="text-[13px] font-semibold text-gink">Read it</h2>
            <p className="mt-1.5 text-[12.5px] leading-[1.5] text-gink-46">
              We read the dishes, prices and photos, and mark anything we are not sure about. Nothing
              is saved until you check it.
            </p>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <button
              type="button"
              className={btn('solid')}
              onClick={read}
              disabled={working}
            >
              {status === 'reading' ? 'Reading your menu…' : 'Read this menu'}
            </button>

            {status === 'reading' && (
              <p role="status" className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">
                This usually takes about twenty seconds — longer when the reader is busy. Keep this
                tab open.
              </p>
            )}
          </div>
        </Card>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-[12px] border border-[var(--p-due)]/30 bg-[var(--p-due)]/8 px-4 py-3"
        >
          <strong className="text-[12.5px] text-[var(--p-due)]">That did not work.</strong>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-64">{error}</p>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-[12px] border border-[var(--p-accent)]/25 bg-accent-soft px-4 py-2.5"
        >
          <strong className="text-[12.5px] text-gink">Saved.</strong>{' '}
          <span className="text-[12.5px] text-gink-64">{notice}</span>
        </div>
      )}

      {/* ------------------------------------------------------------- review */}
      {status === 'review' && categories.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hair px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-[13px] font-semibold text-gink">Check every dish</h2>
              <p className="mt-1 max-w-[62ch] text-[12.5px] leading-[1.5] text-gink-46">
                {keptCount} dish{keptCount === 1 ? '' : 'es'} read with {model}. Rows marked in amber
                need you. Nothing is published until you publish it.
              </p>
            </div>
            <button type="button" className={btn('ghost', 'sm')} onClick={reset} disabled={working}>
              Start over
            </button>
          </div>

          <div className="px-4 py-3 sm:px-5">
            {notes.length > 0 && (
              <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0">
                {notes.map((note) => (
                  <li
                    key={note}
                    className="flex gap-2 text-[11.5px] leading-[1.5] text-gink-64"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[7px] size-1 shrink-0 rounded-full bg-gink-28"
                    />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            )}

            {categories.map((category, ci) => (
              <div key={`${category.name}-${ci}`} className="mb-4 last:mb-0">
                <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.09em] text-gink-46 uppercase">
                  {category.name}
                </div>

                <ul className="m-0 flex list-none flex-col p-0">
                  {category.items.map((item, ii) => {
                    const isDropped = dropped.has(`${ci}:${ii}`);
                    const needsPrice = item.price.trim() === '';
                    const flagged = needsPrice || item.flags.length > 0;

                    return (
                      <li
                        key={`${item.name}-${ii}`}
                        data-dropped={isDropped ? 'true' : undefined}
                        data-flagged={flagged && !isDropped ? 'true' : undefined}
                        className={[
                          'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hair py-2 last:border-b-0',
                          isDropped ? 'opacity-40' : '',
                        ].join(' ')}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-gink">
                            <span
                              data-veg={
                                item.isVeg === false ? 'non' : item.isVeg === true ? 'veg' : 'unknown'
                              }
                              aria-hidden="true"
                            >
                              <VegMark veg={item.isVeg} />
                            </span>
                            <span className="truncate">{item.name}</span>
                          </div>

                          {(item.flags.length > 0 || item.photo) && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {item.flags.map((flag) => (
                                <span
                                  key={flag}
                                  className="inline-flex items-center rounded-full bg-[var(--p-due)]/8 px-2 py-0.5 text-[10.5px] font-medium text-[var(--p-due)]"
                                >
                                  {FLAG_TEXT[flag] ?? flag}
                                </span>
                              ))}
                              {item.photo && (
                                <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-[var(--p-accent)]">
                                  Photo found
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {/* An empty price is a question, not a zero: it stays
                              empty and blocks the save until it is answered. */}
                          <label className="relative">
                            <span className="sr-only">{`Price for ${item.name}`}</span>
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[12.5px] text-gink-46"
                            >
                              ₹
                            </span>
                            <input
                              className={`${inputClass} h-9! w-[86px]! pl-6! text-[12.5px]! tabular-nums`}
                              inputMode="decimal"
                              value={item.price}
                              placeholder="—"
                              onChange={(event) => editPrice(ci, ii, event.target.value)}
                              disabled={isDropped || working}
                              aria-label={`Price for ${item.name}`}
                            />
                          </label>

                          <button
                            type="button"
                            className={`${btn('ghost', 'sm')} gap-1 px-2`}
                            onClick={() => toggleVeg(ci, ii)}
                            disabled={isDropped || working}
                            aria-pressed={item.isVeg === true}
                            title={
                              item.isVeg === null
                                ? 'Mark vegetarian'
                                : item.isVeg === true
                                  ? 'Change to non-veg'
                                  : 'Clear the mark'
                            }
                          >
                            <span
                              data-veg={
                                item.isVeg === false ? 'non' : item.isVeg === true ? 'veg' : 'unknown'
                              }
                              aria-hidden="true"
                            >
                              <VegMark veg={item.isVeg} />
                            </span>
                            <span className="text-[11.5px]">
                              {item.isVeg === null ? 'Unmarked' : item.isVeg ? 'Veg' : 'Non-veg'}
                            </span>
                          </button>

                          <button
                            type="button"
                            className={btn('quiet', 'sm')}
                            onClick={() => drop(ci, ii)}
                            disabled={working}
                          >
                            {isDropped ? 'Keep' : 'Remove'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-hair px-4 py-3 sm:px-5">
            <p className="m-0 text-[11.5px] leading-[1.45] text-gink-46">
              {keptCount} dish{keptCount === 1 ? '' : 'es'} ready. The save is at the bottom of the
              page — dishes and brand style go in together as one draft.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
