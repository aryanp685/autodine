'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DashboardBar } from '@/components/DashboardBar';
import { SignInPrompt } from '@/components/SignInPrompt';
import { VegMark } from '@/components/ui';
import { createImportedMenuAction, previewMenuImportAction, type ImportPreview } from '@/app/dashboard/menus/import-actions';
import { PhotoImportPanel } from '@/components/PhotoImportPanel';
import { draftItemCount, MAX_IMPORT_TEXT } from '@/lib/menu-import';
import { inr } from '@/lib/demo-data';
import { paiseToRupees } from '@/lib/money';
import type { OutletBar } from '@/lib/outlets';

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
}: {
  outlet?: OutletBar | null;
  /** owner/manager can write; anyone else can read this screen and not save. */
  role?: string;
  blocked?: 'signed-out' | 'no-membership';
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [writing, startWriting] = useTransition();

  const canWrite = !blocked && (role === 'owner' || role === 'manager');

  /* Which input the owner is using. Photo first, because a restaurant with a
     printed card already has the thing this needs and typing it out is the
     long way round. The text path stays as a peer, not a fallback: it is the
     one that works when the AI is off, and it is faster for a short menu. */
  const [mode, setMode] = useState<'photo' | 'text'>('photo');

  function readMenu() {
    setError(null);
    startReading(async () => {
      const result = await previewMenuImportAction(text);
      setPreview(result);
      setDropped(new Set());
      if (!result.ok) setError(result.error);
    });
  }

  function createMenu() {
    if (!preview?.ok) return;
    setError(null);

    const kept = {
      categories: preview.draft.categories.filter((_, index) => !dropped.has(index)),
    };

    startWriting(async () => {
      const result = await createImportedMenuAction(kept);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push('/dashboard/menus');
    });
  }

  const draft = preview?.ok ? preview.draft : null;
  const keptCount = draft
    ? draft.categories.filter((_, index) => !dropped.has(index)).reduce((sum, category) => sum + category.items.length, 0)
    : 0;

  return (
    <div className="pg pg--dash">
      <DashboardBar active="menus" outlet={outlet} />

      <div className="pg__body">
        <header className="pg__head">
          <div className="pg__kicker">Menu · import</div>
          <h1 className="pg__title">Bring in a menu you already have</h1>
          <p className="pg__lede">
            Photograph your printed menu and we read the dishes, prices and pictures for you to check. Or
            paste the text. Nothing is saved until you approve it.
          </p>
        </header>

        {/* Two inputs, one result. A tab strip rather than two screens, so the
            owner never has to guess which page to be on. */}
        {!blocked && (
          <div className="photoImport__modes" role="tablist" aria-label="How to import">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'photo'}
              className={`photoImport__mode ${mode === 'photo' ? 'is-on' : ''}`}
              onClick={() => setMode('photo')}
            >
              Photo of your menu
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'text'}
              className={`photoImport__mode ${mode === 'text' ? 'is-on' : ''}`}
              onClick={() => setMode('text')}
            >
              Paste the text
            </button>
          </div>
        )}

        {mode === 'photo' && !blocked && <PhotoImportPanel canWrite={canWrite} />}

        {blocked && <SignInPrompt reason={blocked} screen="menu import" />}

        {error && (
          <div className="pg__alert" role="alert">
            <strong>Nothing was imported.</strong>
            <p>{error}</p>
          </div>
        )}

        {mode === 'text' && !preview?.ok && !blocked && (
          <section className="pg__formCard">
            <h2 className="pg__h">The menu text</h2>
            <p className="pg__p">
              Section headings on their own line, then the dishes. Prices can be written as 320, ₹320, 320/- or
              1,200.
            </p>

            <div className="pg__form">
              <label className="ui-field">
                <span className="ui-label">Paste here</span>
                <textarea
                  className="ui-input"
                  name="menuText"
                  rows={14}
                  maxLength={MAX_IMPORT_TEXT}
                  placeholder={SAMPLE}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                <span className="ui-hint">
                  {text.length.toLocaleString('en-IN')} of {MAX_IMPORT_TEXT.toLocaleString('en-IN')} characters. A
                  photograph of a menu cannot be pasted — type or copy the text.
                </span>
              </label>

              <div className="pg__rowEnd">
                <button
                  type="button"
                  className="pg__btn"
                  onClick={() => setText(SAMPLE)}
                  disabled={reading || writing}
                >
                  Use the example
                </button>
                <button type="button" className="pg__submit" onClick={readMenu} disabled={reading || writing}>
                  {reading ? 'Reading…' : 'Read the menu'}
                </button>
              </div>
            </div>

            <p className="pg__fine">
              Reading a menu with a language model is optional and off unless this deployment has a key configured.
              When it is off, the text is read by rules: a line with a price is a dish, a short line without one is a
              section. Either way you see the result before anything is written.
            </p>
          </section>
        )}

        {draft && (
          <section className="pg__formCard">
            <h2 className="pg__h">Check before importing</h2>
            <p className="pg__p">
              {draft.categories.length} section{draft.categories.length === 1 ? '' : 's'} ·{' '}
              {draftItemCount(draft)} dish{draftItemCount(draft) === 1 ? '' : 'es'}. Untick a section to leave it out.
            </p>

            {preview?.ok && preview.note && <p className="pg__fine">{preview.note}</p>}

            <div className="pg__form">
              {draft.categories.map((category, index) => (
                <div key={`${category.name}-${index}`} className="pg__formCard">
                  <label className="pg__check">
                    <input
                      type="checkbox"
                      checked={!dropped.has(index)}
                      onChange={(event) => {
                        const next = new Set(dropped);
                        if (event.target.checked) next.delete(index);
                        else next.add(index);
                        setDropped(next);
                      }}
                    />{' '}
                    <strong>{category.name}</strong> · {category.items.length} dish
                    {category.items.length === 1 ? '' : 'es'}
                  </label>

                  <ul className="pg__bullets">
                    {category.items.map((item, itemIndex) => (
                      <li key={`${item.name}-${itemIndex}`}>
                        <VegMark veg={item.isVeg} /> {item.name} — {inr(paiseToRupees(item.pricePaise))}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {draft.issues.length > 0 && (
              <div className="pg__note pg__note--warn">
                <strong>{draft.issues.length} line(s) were not imported.</strong> Fix these in your own document and
                paste again, or add them by hand afterwards.
                <ul className="pg__bullets">
                  {draft.issues.slice(0, 12).map((issue, index) => (
                    <li key={index}>
                      <code>{issue.line}</code> — {issue.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {draft.duplicates > 0 && (
              <p className="pg__fine">
                {draft.duplicates} duplicate line{draft.duplicates === 1 ? ' was' : 's were'} dropped because the
                same dish with the same price appeared twice.
              </p>
            )}

            <div className="pg__note pg__note--info">
              <strong>Veg and non-veg are guessed from the dish names.</strong> Anything with chicken, mutton, fish,
              prawn or egg is marked non-veg; everything else is marked veg. Check the markers above — a wrong one
              is a real problem for a guest, not a detail.
            </div>

            {!canWrite ? (
              <p className="pg__fine">
                Only an owner or manager can add a menu. You are signed in as {role ?? 'staff'}.
              </p>
            ) : (
              <div className="pg__rowEnd">
                <button
                  type="button"
                  className="pg__btn"
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
                  className="pg__submit"
                  onClick={createMenu}
                  disabled={writing || reading || keptCount === 0}
                >
                  {writing ? 'Importing…' : `Import ${keptCount} dish${keptCount === 1 ? '' : 'es'} as a draft menu`}
                </button>
              </div>
            )}

            <p className="pg__fine">
              The import becomes a new <strong>draft</strong> menu called &quot;Imported menu&quot;, so your live menu
              is not touched. Review it in the editor, then publish when it is right.
            </p>
          </section>
        )}

        <p className="pg__foot">
          <Link href="/dashboard/menus">Back to the menu editor</Link>
        </p>
      </div>
    </div>
  );
}
