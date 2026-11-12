'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SignInPrompt } from '@/components/SignInPrompt';
import { attachImportPhotosAction, type CropUpload } from '@/app/(staff)/dashboard/menus/import-actions';
import { createImportPairAction } from '@/app/(staff)/dashboard/menus/brand-actions';
import { BrandReview, brandStateToDraft, type BrandReviewState } from '@/components/screens/BrandReview';
import { DesignChooser } from '@/components/screens/DesignChooser';
import { designCandidates, type DesignId } from '@/lib/branding/designs';
import { ImportShowcase } from '@/components/screens/ImportShowcase';
import { PhotoImportPanel, type PhotoDraft } from '@/components/PhotoImportPanel';
import { TextImportPanel } from '@/components/TextImportPanel';
import { cropFromImage } from '@/lib/import/crop';
import type { OutletBar } from '@/lib/outlets';
import { Card, OwnerPage, PageHead, btn } from '@/components/owner/chrome';

/**
 * The AI Menu Studio journey, in four words the owner can follow: add the
 * menu, check it, choose a design, publish. Only the first two steps exist
 * on this screen today — the design step is next on the build — so the last
 * two render dashed and quiet instead of pretending to be buttons.
 */
const STEPS = [
  { label: 'Add Menu', sub: 'Upload or import' },
  { label: 'Review', sub: 'Check items & brand' },
  { label: 'Choose Design', sub: 'Pick your style' },
  { label: 'Publish', sub: 'Go live in minutes' },
];

const BENEFITS = [
  {
    title: 'Auto Extract Menu',
    sub: 'Dishes, prices & categories',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4">
        <path
          d="M11 2L4 11h4l-1 7 7-10h-4l1-6z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: 'Detect Your Brand',
    sub: 'Logo, colours & style',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4">
        <path
          d="M10 2l7 3.5-7 3.5-7-3.5L10 2zM3 9.5l7 3.5 7-3.5M3 13l7 3.5 7-3.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: 'Get 2 Design Options',
    sub: 'Branded storefront styles',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4">
        <rect x="2.5" y="4" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="8.5" y="6.5" width="9" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    title: 'Publish in Minutes',
    sub: 'Go live with your brand',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4">
        <path
          d="M2.5 9.5L17 3l-4.5 14.5-3-6-7-2z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

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
  /** Does this deployment have a vision key for the optional photo path? */
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
  /**
   * The chosen storefront design — step 3. Optional on purpose: with no pick
   * the save keeps the extracted style exactly as it always has.
   */
  const [designPick, setDesignPick] = useState<DesignId | null>(null);

  const designs = designCandidates(brandState?.theme ?? null);
  const chosenDesign = designs.find((design) => design.id === designPick) ?? null;

  /* The real extracted rows, for the design previews: the same names and
     prices the save will write. */
  const previewDishes = photoDraft
    ? photoDraft.payload.categories.flatMap((category) =>
        category.items.map((item) => ({
          category: category.name,
          name: item.name,
          pricePaise: item.pricePaise,
        }))
      )
    : [];

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
        // brand half rolls the menu half back (createImportPairAction). A
        // chosen design replaces the auto-resolved style in that same draft.
        const brand = brandState ? brandStateToDraft(brandState, importId) : null;
        const brandDraft = chosenDesign
          ? { ...(brand ?? { importId }), theme: chosenDesign.theme }
          : (brand ?? { importId });
        const result = await createImportPairAction({
          menu: { ...photoDraft.payload, importId },
          brand: brandDraft,
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
      {/* The hero band: the masthead and journey steps on the left, the
          menu-to-storefront showcase on the right. The showcase is a
          demonstration on design-system tokens — flat paper, no gradients. */}
      <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.85fr)] lg:items-center">
        <div className="min-w-0">
          <PageHead
            kicker="AI Menu Studio"
            title={
              <>
                Turn Your Menu into a <span className="text-plum">Branded Storefront</span>
              </>
            }
            meta="Upload your existing menu and let AI extract items, prices, photos and your brand style — then get two ready-to-publish designs."
            actions={
              <Link href="/dashboard/menus" className={btn('ghost', 'sm')}>
                Back to the menu editor
              </Link>
            }
          />

          {/* The journey so far, from real state only: publish stays dashed
              because it happens on the menu draft, in the editor. */}
          {!blocked && (
            <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0" data-import-steps>
              {STEPS.map((step, index) => {
                const position = photoDraft ? (designPick ? 2 : 1) : 0;
                const state =
                  index === 3
                    ? 'upcoming'
                    : index < position
                      ? 'done'
                      : index === position
                        ? 'active'
                        : 'todo';
                return (
                  <li key={step.label} className="flex min-w-0 items-center gap-1.5">
                    <span
                      data-step={state}
                      className={[
                        'flex min-w-0 items-center gap-2 rounded-[10px] border px-2.5 py-1.5',
                        state === 'active'
                          ? 'border-plum bg-plum font-semibold text-onink'
                          : state === 'done'
                            ? 'border-gink bg-gink text-onink'
                            : state === 'todo'
                              ? 'border-hair bg-card text-gink'
                              : 'border-dashed border-hair text-gink-28',
                      ].join(' ')}
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          'grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold',
                          state === 'active'
                            ? 'bg-onink text-plum'
                            : state === 'done'
                              ? 'bg-onink text-gink'
                              : 'bg-gink-07 text-gink-46',
                        ].join(' ')}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11.5px] leading-tight">{step.label}</span>
                        <span
                          className={[
                            'block truncate text-[10px] leading-tight',
                            state === 'active' ? 'text-onink/70' : 'text-gink-46',
                          ].join(' ')}
                        >
                          {step.sub}
                        </span>
                      </span>
                    </span>
                    {index < STEPS.length - 1 ? (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 12 12"
                        fill="none"
                        className="hidden size-3 shrink-0 text-gink-28 sm:block"
                      >
                        <path
                          d="M4 2.5L7.5 6L4 9.5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <ImportShowcase />
      </div>

      {blocked && <SignInPrompt reason={blocked} screen="menu import" />}

      {!blocked && visionEnabled && (
        <PhotoImportPanel canWrite={canWrite} onFileChange={setMenuFile} onDraftChange={setPhotoDraft} />
      )}
      {!blocked && <TextImportPanel canWrite={canWrite} onDraftChange={setPhotoDraft} />}

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

      {/* Step 3: the storefront design — real previews of the real draft,
          painted by the same pipeline the guest menu uses. Optional: with no
          pick, the save keeps the extracted style. */}
      {!blocked && canWrite && photoDraft && (
        <DesignChooser
          designs={designs}
          selectedId={designPick}
          onSelect={setDesignPick}
          name={
            brandState?.name ??
            outlet?.outlets.find((o) => o.id === outlet.activeId)?.name ??
            'Your restaurant'
          }
          logoUrl={brandState?.logoUrl ?? null}
          bannerUrl={brandState?.bannerUrl ?? null}
          dishes={previewDishes}
        />
      )}

      {/* The one save. Below the brand review on purpose: dishes and brand
          style go in together. */}
      {!blocked && canWrite && photoDraft && (
        <Card className="mt-4">
          <div className="border-b border-hair px-4 py-3 sm:px-5">
            <h2 className="text-[13px] font-semibold text-gink">Save the draft</h2>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-46">
              Dishes and brand style save together as one draft
              {chosenDesign ? ` (${chosenDesign.name})` : ''}. Your live menu is untouched.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-4 sm:px-5">
            <button type="button" className={btn('solid')} onClick={saveImport} disabled={writing}>
              {writing ? 'Saving…' : `Save ${saveCount} dish${saveCount === 1 ? '' : 'es'} as a draft`}
            </button>
          </div>
        </Card>
      )}

      {/* What this journey does, in four lines — the page-end summary, after
          the actions instead of in their way. */}
      <section
        aria-label="What the import does"
        className="mt-6 grid gap-x-6 gap-y-4 border-t border-hair pt-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {BENEFITS.map((benefit) => (
          <div key={benefit.title} className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-plum-soft text-plum"
            >
              {benefit.icon}
            </span>
            <div className="min-w-0">
              <p className="m-0 truncate text-[13px] font-semibold text-gink">{benefit.title}</p>
              <p className="m-0 truncate text-[11.5px] text-gink-46">{benefit.sub}</p>
            </div>
          </div>
        ))}
      </section>
    </OwnerPage>
  );
}
