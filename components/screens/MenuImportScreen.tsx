'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SignInPrompt } from '@/components/SignInPrompt';
import { attachImportPhotosAction, type CropUpload } from '@/app/(staff)/dashboard/menus/import-actions';
import { createImportPairAction } from '@/app/(staff)/dashboard/menus/brand-actions';
import { BrandReview, brandStateToDraft, type BrandReviewState } from '@/components/screens/BrandReview';
import { PhotoImportPanel, type PhotoDraft } from '@/components/PhotoImportPanel';
import { cropFromImage } from '@/lib/import/crop';
import type { OutletBar } from '@/lib/outlets';
import { Card, OwnerPage, PageHead, btn } from '@/components/owner/chrome';

/**
 * Bring in a menu that already exists elsewhere.
 *
 * One way in: photograph the menu. The owner's own printed card is the
 * source every restaurant already has, and one path kept honest beats three
 * kept busy. The review is not decoration: it is where the owner sees that
 * "Paneer Tikka 320" became a ₹320 dish and that four dishes need a price
 * before anything is written.
 *
 * The save is one action at the bottom of the page — dishes and brand style
 * go in together, as one draft. Nothing goes live until the owner publishes
 * from the editor.
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
   * Passed from the server because it is an environment fact. When it is
   * false there is nothing this screen can do — a photo is the only way in —
   * and it says so instead of offering a path that cannot succeed.
   */
  visionEnabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();

  const canWrite = !blocked && (role === 'owner' || role === 'manager');

  /* The stable import identifier: the menu draft and the brand draft share
     it, and a repeated Create finds the same pair instead of doubling it. */
  const [importId] = useState(() => crypto.randomUUID());
  const [menuFile, setMenuFile] = useState<File | null>(null);
  const [brandState, setBrandState] = useState<BrandReviewState | null>(null);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft | null>(null);

  const saveCount = photoDraft
    ? photoDraft.payload.categories.reduce((sum, category) => sum + category.items.length, 0)
    : 0;

  /*
   * The one save, below the brand review on purpose: whatever the owner
   * checked — dishes and brand style — goes in together, as one draft. Dish
   * photos are cropped after the menu exists and may fail without losing the
   * import.
   */
  function saveImport() {
    setError(null);
    if (!photoDraft) return;
    if (photoDraft.missingPrice) {
      setError('Some dishes have no price. Type one, or remove the dish.');
      return;
    }

    startWriting(async () => {
      try {
        // The pair: menu draft AND brand draft, one import id. A failure in the
        // brand half rolls the menu half back (createImportPairAction).
        const brand = brandState ? brandStateToDraft(brandState, importId) : null;
        const result = await createImportPairAction({
          menu: { ...photoDraft.payload, importId },
          brand: brand ?? { importId },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }

        let photoNote = '';
        const crops = photoDraft.crops;
        if (crops.length > 0 && photoDraft.file) {
          if (photoDraft.file.type === 'application/pdf') {
            // Honest limit, said out loud: a PDF is read for dishes and
            // prices, but dish photos are cropped from images only.
            photoNote = ' Dish photos were not copied from the PDF — add them by hand in the editor.';
          } else {
            const ready: CropUpload[] = [];
            for (const crop of crops) {
              const cut = await cropFromImage(photoDraft.file, crop.box);
              if (cut) {
                ready.push({
                  categoryIndex: crop.categoryIndex,
                  itemIndex: crop.itemIndex,
                  dataUrl: cut.dataUrl,
                });
              }
            }
            const failed = crops.length - ready.length;
            if (ready.length > 0) {
              const attached = await attachImportPhotosAction(result.menuId, ready);
              if (attached.ok && attached.skipped > 0) {
                const names =
                  attached.skippedNames.length > 0 ? ` (${attached.skippedNames.join(', ')})` : '';
                photoNote = ` ${attached.skipped} photo${attached.skipped === 1 ? '' : 's'} could not be copied${names} — add them by hand in the editor.`;
              }
            }
            if (failed > 0 && photoNote === '') {
              photoNote = ` ${failed} photo${failed === 1 ? '' : 's'} could not be copied — add them by hand in the editor.`;
            }
          }
        }

        router.push(
          `/dashboard/menus?menu=${result.menuId}&notice=${encodeURIComponent(
            `Draft imported with ${result.items} dish${result.items === 1 ? '' : 'es'}.${photoNote} Check it, then publish when you are ready.`,
          )}`,
        );
      } catch {
        // A thrown server action must not leave the Save button stuck —
        // blocked buttons with a draft that never arrived is the bug class
        // this catch prevents.
        setError('Something went wrong saving the menu. Try again — nothing was changed.');
      }
    });
  }

  return (
    <OwnerPage active="import" outlet={outlet}>
      <PageHead
        kicker="Menu · import"
        title="Bring in a menu you already have"
        meta="Photograph your printed menu and we read the dishes, prices and pictures for you to check. Nothing is saved until you approve it."
        actions={
          <Link href="/dashboard/menus" className={btn('ghost', 'sm')}>
            Back to the menu editor
          </Link>
        }
      />

      {/* The progress strip: where the owner is, in one line. Derived from
          real state only — the save step lights up while the save runs, and
          nothing claims a step that has not happened. */}
      {!blocked && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5" data-import-steps>
          {['Add your menu', 'Check dishes & brand', 'Save the draft'].map((label, index) => {
            const position = writing ? 2 : photoDraft || menuFile ? 1 : 0;
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

      {blocked && <SignInPrompt reason={blocked} screen="menu import" />}

      {!blocked && visionEnabled && (
        <PhotoImportPanel canWrite={canWrite} onFileChange={setMenuFile} onDraftChange={setPhotoDraft} />
      )}
      {!blocked && !visionEnabled && (
        <Card>
          <p className="m-0 px-4 py-4 text-[12.5px] leading-[1.55] text-gink-64 sm:px-5">
            Reading a photograph needs a vision service on this deployment, and this one does not
            have it configured. Add dishes by hand in the menu editor instead.
          </p>
        </Card>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-[12px] border border-[var(--p-due)]/30 bg-[var(--p-due)]/8 px-4 py-3 text-[12.5px] text-[var(--p-due)]"
        >
          {error}
        </p>
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

      {/* The one save. Below the brand review on purpose: dishes and brand
          style go in together. */}
      {!blocked && canWrite && photoDraft && (
        <Card className="mt-4">
          <div className="border-b border-hair px-4 py-3 sm:px-5">
            <h2 className="text-[13px] font-semibold text-gink">Save the draft</h2>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-46">
              Dishes and brand style go in together as a new draft menu. Your live menu is not
              touched — publish from the editor when it looks right.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-4 sm:px-5">
            <button type="button" className={btn('solid')} onClick={saveImport} disabled={writing}>
              {writing ? 'Saving…' : `Save ${saveCount} dish${saveCount === 1 ? '' : 'es'} as a draft`}
            </button>
          </div>
        </Card>
      )}
    </OwnerPage>
  );
}
