'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { VegMark } from '@/components/ui';
import {
  attachImportPhotosAction,
  createImportedMenuAction,
  extractMenuFromPhotoAction,
  type CropUpload,
  type PhotoPreview,
} from '@/app/dashboard/menus/import-actions';
import { MAX_MENU_PHOTO_BYTES, type VisionCategory } from '@/lib/ai/menu-vision';
import { cropFromImage } from '@/lib/import/crop';

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

const FLAG_TEXT: Record<string, string> = {
  'price-unclear': 'Price unclear — check the photo',
  'no-price-printed': 'No price in the photo',
  'name-unclear': 'Name unclear',
  'veg-unclear': 'No veg mark',
};

export function PhotoImportPanel({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
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

  const [working, startWork] = useTransition();

  function reset() {
    setFile(null);
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
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    // A PDF has no thumbnail; the <img> would show a broken icon, so only an
    // image gets a preview.
    setPreviewUrl(picked.type === 'application/pdf' ? null : URL.createObjectURL(picked));
    setStatus('idle');
    setCategories([]);
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
                i !== ii ? item : { ...item, isVeg: item.isVeg === false ? true : false }
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

  // A dish with no price cannot be saved: it would either be free or invent a
  // number, and both are worse than asking.
  const missingPrice = kept.some((c) => c.items.some((item) => item.price.trim() === ''));

  function save() {
    setError(null);
    setNotice(null);

    if (keptCount === 0) {
      setError('Nothing is selected. Keep at least one dish, or start again.');
      return;
    }
    if (missingPrice) {
      setError('Some dishes have no price. Type one, or remove the dish.');
      return;
    }

    setStatus('saving');

    startWork(async () => {
      const payload = {
        categories: kept
          .filter((c) => c.items.length > 0)
          .map((c) => ({
            name: c.name,
            items: c.items.map((item) => ({
              name: item.name,
              // Rupees -> paise at the boundary, rounded the same way the rest
              // of the product does it.
              pricePaise: Math.round(Number(item.price.replace(/[^\d.]/g, '')) * 100),
              description: null as string | null,
              isVeg: item.isVeg !== false,
            })),
          })),
      };

      const created = await createImportedMenuAction(payload);
      if (!created.ok) {
        setError(created.error);
        setStatus('review');
        return;
      }

      // Photos next, and they are allowed to fail without losing the menu:
      // text with no thumbnails is a good import, a rolled-back import is not.
      let attached = 0;
      let skipped = 0;

      if (file) {
        const crops: CropUpload[] = [];
        const isPdf = file.type === 'application/pdf';

        if (!isPdf) {
          for (let ci = 0; ci < kept.length; ci += 1) {
            for (let ii = 0; ii < kept[ci].items.length; ii += 1) {
              const box = kept[ci].items[ii].photo;
              if (!box) continue;
              const crop = await cropFromImage(file, box);
              if (!crop) continue;
              crops.push({ categoryIndex: ci, itemIndex: ii, dataUrl: crop.dataUrl });
            }
          }
        }

        if (crops.length > 0) {
          const result = await attachImportPhotosAction(created.menuId, crops);
          if (result.ok) {
            attached = result.attached;
            skipped = result.skipped;
          }
        }
      }

      setStatus('review');
      setNotice(
        `Saved as a draft menu with ${created.items} dish${created.items === 1 ? '' : 'es'}.` +
          (attached > 0 ? ` ${attached} photo${attached === 1 ? '' : 's'} copied from your menu.` : '') +
          (skipped > 0 ? ` ${skipped} photo${skipped === 1 ? '' : 's'} could not be copied.` : '')
      );

      // The editor is where the next decision lives: publish, or keep editing.
      router.push(`/dashboard/menus?menu=${created.menuId}&notice=${encodeURIComponent('Draft imported. Check it, then publish when you are ready.')}`);
    });
  }

  if (!canWrite) {
    return (
      <p className="pg__note pg__note--info">
        <strong>Read-only for your role.</strong> An owner or manager can import a menu.
      </p>
    );
  }

  return (
    <div className="photoImport">
      {/* ------------------------------------------------------------- pick */}
      <section className="photoImport__step">
        <div className="photoImport__stepHead">
          <span className="photoImport__stepNum">1</span>
          <h2 className="pg__h2">Photo of your menu</h2>
        </div>
        <p className="pg__p">
          Point at a printed menu — the whole card in frame, flat, in good light. JPG, PNG, WebP or PDF,
          up to 8 MB and 3 pages.
        </p>

        <div className="photoImport__pick">
          {/* A plain <img>, not next/image: this is a blob: URL for a file
              that only exists in this tab, which the optimiser cannot fetch. */}
          {previewUrl ? (
            <img src={previewUrl} alt="The menu you are about to read" className="photoImport__thumb" />
          ) : file ? (
            <div className="photoImport__pdf">PDF selected<br />{file.name.slice(0, 40)}</div>
          ) : (
            <div className="photoImport__empty">No photo yet</div>
          )}

          <div className="photoImport__pickActions">
            <label className="brand__picker">
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                /* `capture` opens the camera on a phone and is ignored on a
                   desktop, which is exactly the behaviour wanted: one control,
                   right on both. */
                capture="environment"
                onChange={(event) => pick(event.target.files?.[0] ?? null)}
              />
              <span>{file ? 'Choose another' : 'Take or choose a photo'}</span>
            </label>
            {file && (
              <button type="button" className="photoImport__link" onClick={reset}>
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- read */}
      {file && status !== 'review' && (
        <section className="photoImport__step">
          <div className="photoImport__stepHead">
            <span className="photoImport__stepNum">2</span>
            <h2 className="pg__h2">Read it</h2>
          </div>
          <p className="pg__p">
            We read the dishes, prices and photos, and mark anything we are not sure about. Nothing is
            saved until you check it.
          </p>

          <button type="button" className="pg__btn pg__btn--solid" onClick={read} disabled={working}>
            {status === 'reading' ? 'Reading your menu…' : 'Read this menu'}
          </button>

          {status === 'reading' && (
            <p className="photoImport__progress" role="status">
              This usually takes about twenty seconds. Keep this tab open.
            </p>
          )}
        </section>
      )}

      {error && (
        <div className="pg__alert" role="alert">
          <strong>That did not work.</strong>
          <p>{error}</p>
        </div>
      )}

      {notice && (
        <div className="pg__success" role="status">
          <strong>Saved.</strong>
          <p>{notice}</p>
        </div>
      )}

      {/* ----------------------------------------------------------- review */}
      {status === 'review' && categories.length > 0 && (
        <section className="photoImport__review">
          <div className="photoImport__reviewHead">
            <div>
              <h2 className="pg__h2">Check every dish</h2>
              <p className="pg__p">
                {keptCount} dish{keptCount === 1 ? '' : 'es'} read with {model}. Rows marked in amber need
                you. Nothing is published until you publish it.
              </p>
            </div>
            <button type="button" className="pg__btn" onClick={reset} disabled={working}>
              Start over
            </button>
          </div>

          {notes.length > 0 && (
            <ul className="photoImport__notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          {categories.map((category, ci) => (
            <div key={`${category.name}-${ci}`} className="photoImport__cat">
              <div className="photoImport__catName">{category.name}</div>

              {category.items.map((item, ii) => {
                const isDropped = dropped.has(`${ci}:${ii}`);
                const needsPrice = item.price.trim() === '';

                return (
                  <div
                    key={`${item.name}-${ii}`}
                    className={`photoImport__row ${isDropped ? 'is-dropped' : ''} ${needsPrice || item.flags.length ? 'is-flagged' : ''}`}
                  >
                    <div className="photoImport__rowMain">
                      <div className="photoImport__rowName">
                        <span className="photoImport__vegDot" data-veg={item.isVeg === false ? 'non' : item.isVeg === true ? 'veg' : 'unknown'} aria-hidden="true" />
                        {item.name}
                      </div>

                      <div className="photoImport__rowMeta">
                        {item.flags.map((flag) => (
                          <span key={flag} className="photoImport__flag">
                            {FLAG_TEXT[flag] ?? flag}
                          </span>
                        ))}
                        {item.photo && <span className="photoImport__photoTag">Photo found</span>}
                      </div>
                    </div>

                    <div className="photoImport__rowControls">
                      <label className="ui-field photoImport__priceField">
                        <span className="ui-label">₹</span>
                        <input
                          className="ui-input tnum"
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
                        className="photoImport__vegBtn"
                        onClick={() => toggleVeg(ci, ii)}
                        disabled={isDropped || working}
                        aria-pressed={item.isVeg === true}
                        title={item.isVeg === null ? 'Mark vegetarian' : 'Change veg / non-veg'}
                      >
                        <VegMark veg={item.isVeg !== false} />
                        <span>{item.isVeg === null ? 'Set' : item.isVeg ? 'Veg' : 'Non-veg'}</span>
                      </button>

                      <button
                        type="button"
                        className="photoImport__link"
                        onClick={() => drop(ci, ii)}
                        disabled={working}
                      >
                        {isDropped ? 'Keep' : 'Remove'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="photoImport__footer">
            <p className="brand__fine">Saves as a draft. Publish from Menus when it looks right.</p>
            <button
              type="button"
              className="pg__btn pg__btn--solid"
              onClick={save}
              disabled={working || keptCount === 0}
            >
              {working ? 'Saving…' : `Save ${keptCount} dish${keptCount === 1 ? '' : 'es'} as a draft`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
