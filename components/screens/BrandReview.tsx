'use client';

/**
 * The Brand Review: one section of the import flow, answering one question —
 * "how should this restaurant LOOK to a guest?"
 *
 * HOW IT HONOURS THE SPEC'S DISCIPLINE
 *
 *   - Extraction writes nothing. Reading brand style returns suggestions;
 *     every value is on screen before anything exists in the database.
 *   - Priority is visible, not implicit: the source of the name and the
 *     colour is printed next to each (lib/branding/resolve.ts decides, this
 *     component only shows what it decided and where the conflicts are).
 *   - The name goes live only after the owner CONFIRMS it. The checkbox is
 *     the spec's "owner confirmation required", and publish refuses without
 *     it.
 *   - A decorative mark is never "the logo": an extracted logo box is a
 *     candidate the owner must accept (by cropping from the photo, which is
 *     the printed mark itself) or replace with an upload.
 *   - Failure is a sentence plus a retry, and it never touches the menu
 *     review above it: two extractions, two reviews, one Create.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  extractBrandFromPhotoAction,
  uploadBrandAssetAction,
  type BrandPreview,
  type UploadResult,
} from '@/app/(staff)/dashboard/menus/brand-actions';
import {
  assetConflicts,
  buildTheme,
  resolveBanner,
  resolveLogo,
  resolveName,
  resolvePrimary,
} from '@/lib/branding/resolve';
import { parseHex, parseTheme, type BrandTheme } from '@/lib/branding/theme';
import type { BrandConflict, BrandDraft, FieldSource } from '@/lib/branding/draft';
import type { BrandExtraction } from '@/lib/ai/brand-vision';
import { Card, Tag, btn, inputClass } from '@/components/owner/chrome';

export type BrandReviewState = {
  name: string | null;
  nameConfirmed: boolean;
  theme: BrandTheme | null;
  logoAssetId: string | null;
  bannerAssetId: string | null;
  conflicts: BrandConflict[];
  provenance: Partial<Record<'name' | 'primary' | 'logo' | 'banner' | 'theme', FieldSource>>;
  notes: string[];
};

const SOURCE_LABEL: Record<FieldSource, string> = {
  'owner-confirmed': 'your choice',
  'owner-upload': 'your upload',
  existing: 'current settings',
  'printed-menu': 'printed menu',
  ai: 'suggestion',
};

function sourceTag(source: FieldSource | undefined) {
  if (!source) return null;
  return <Tag tone="neutral">{SOURCE_LABEL[source]}</Tag>;
}

export function BrandReview({
  enabled,
  canWrite,
  existingName,
  file,
  onStateChange,
}: {
  /** A vision key exists: brand extraction is possible at all. */
  enabled: boolean;
  canWrite: boolean;
  existingName: string;
  /** The menu photo already chosen in the import flow, when there is one. */
  file: File | null;
  /** The parent keeps this state and sends it with Create. */
  onStateChange: (state: BrandReviewState) => void;
}) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const extraPhotoRef = useRef<HTMLInputElement>(null);

  const [extraction, setExtraction] = useState<BrandExtraction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [uploading, startUpload] = useTransition();

  const [name, setName] = useState<string>(existingName);
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [ownerPrimary, setOwnerPrimary] = useState<string | null>(null);
  const [logoAssetId, setLogoAssetId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bannerAssetId, setBannerAssetId] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(new Set());

  /* ------------------------------------------------ the resolved answers */

  const nameResolution = resolveName({
    existingName,
    ownerConfirmedName: nameConfirmed ? name : null,
    extraction,
  });
  const primaryResolution = resolvePrimary({ extraction, ownerPrimary });
  const logoResolution = resolveLogo({ uploadedLogoAssetId: logoAssetId, extraction });
  const bannerResolution = resolveBanner({ uploadedBannerAssetId: bannerAssetId, extraction });
  // The primary decision always has a value (resolvePrimary's default is the
  // guest maroon), so the theme is never absent — Create always has a brand
  // half to write.
  const theme =
    buildTheme({ extraction, ownerPrimary, ownerTheme: null }) ??
    parseTheme({ colors: { primary: primaryResolution.resolved.value } });
  const conflicts = [
    ...nameResolution.conflicts,
    ...primaryResolution.conflicts,
    ...assetConflicts({ uploadedLogoAssetId: logoAssetId, extraction }),
  ];
  const conflictKey = (c: BrandConflict) => `${c.field}:${c.message}`;
  const openConflicts = conflicts.filter((c) => !resolvedKeys.has(conflictKey(c)));

  /* Push the state up whenever anything changes. The parent derives the
     Create payload from this; nothing here writes. */
  const state: BrandReviewState = {
    name: nameConfirmed && name.trim() !== '' ? name.trim() : null,
    nameConfirmed,
    theme,
    logoAssetId: logoResolution.value,
    bannerAssetId: bannerResolution.value,
    conflicts: openConflicts,
    provenance: {
      name: nameResolution.resolved.source,
      primary: primaryResolution.resolved.source,
      ...(logoResolution.value ? { logo: logoResolution.source } : {}),
      ...(bannerResolution.value ? { banner: bannerResolution.source } : {}),
      theme: extraction ? 'printed-menu' : 'ai',
    },
    notes: extraction?.notes ?? [],
  };
  // Push the state up after render, never during it. The parent stores it
  // with a functional update keyed on this object.
  useEffect(() => {
    onStateChange(state);
  }, [
    state.name,
    state.nameConfirmed,
    state.theme,
    state.logoAssetId,
    state.bannerAssetId,
    state.conflicts.length,
    state.notes.length,
  ]);

  /* ---------------------------------------------------------- extraction */

  function readBrand(picked: File | null) {
    setError(null);
    setNotice(null);
    const chosen = picked ?? file;
    if (!chosen) {
      setError('Choose a menu photo first — or add one below to read its style.');
      return;
    }
    startReading(async () => {
      try {
        const data = new FormData();
        data.set('photo', chosen);
        const result: BrandPreview = await extractBrandFromPhotoAction(data);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setExtraction(result.extraction);
        setNameConfirmed(false);
        setNotice(
          result.extraction.name
            ? 'Read the visual style. Check the name below before creating.'
            : 'Read the style, but no name was printed on this image. Type the name yourself.',
        );
      } catch {
        // A rejected server action must never leave the read buttons stuck
        // behind a reading state — the owner has to be able to try again.
        setError('Something went wrong reading that image. Try again.');
      }
    });
  }

  /* ------------------------------------------------------------- uploads */

  function upload(kind: 'logo' | 'banner', picked: File | null) {
    if (!picked) return;
    setError(null);
    startUpload(async () => {
      try {
        const data = new FormData();
        data.set('kind', kind);
        data.set('file', picked);
        const result: UploadResult = await uploadBrandAssetAction(data);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (kind === 'logo') {
          setLogoAssetId(result.asset.id);
          setLogoUrl(result.asset.url);
        } else {
          setBannerAssetId(result.asset.id);
          setBannerUrl(result.asset.url);
        }
        setNotice(kind === 'logo' ? 'Logo ready. Your upload always wins.' : 'Banner ready.');
      } catch {
        setError('That upload failed. Try again — nothing was changed.');
      }
    });
  }

  /* ------------------------------------------------------- conflict picks */

  function resolveConflict(conflict: BrandConflict, value: string) {
    const key = conflictKey(conflict);
    setResolvedKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    if (conflict.field === 'name') {
      setName(value);
      setNameConfirmed(true);
    }
    if (conflict.field === 'primary') {
      const hex = parseHex(value);
      if (hex) setOwnerPrimary(hex);
    }
    if (conflict.field === 'logo' && value === 'upload') {
      // Keep the upload; the printed candidate stays a note.
      setNotice('Using your uploaded logo.');
    }
    if (conflict.field === 'logo' && value === 'printed') {
      setNotice('The printed mark is the candidate — accept its crop in the review, or upload the official file.');
    }
  }

  /* --------------------------------------------------------------- render */

  return (
    <Card className="mt-4">
      <div className="border-b border-hair px-4 py-3 sm:px-5">
        <h2 className="text-[13px] font-semibold text-gink">Brand — how guests see you</h2>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-46">
          Name, colours and style from your printed menu, your uploads and your current settings — in that
          order of authority. Nothing goes live until you publish.
        </p>
      </div>

      {!enabled && (
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[12.5px] leading-[1.55] text-gink-64">
            Reading brand style from a photo is not switched on for this deployment. You can still upload a
            logo and banner and pick a colour — they save with the draft like everything else.
          </p>
        </div>
      )}

      {enabled && (
        <div className="flex flex-wrap items-center gap-2 border-b border-hair px-4 py-3 sm:px-5">
          <button
            type="button"
            className={btn('solid', 'sm')}
            disabled={reading || !canWrite}
            onClick={() => readBrand(null)}
          >
            {reading ? 'Reading style…' : file ? 'Read style from the menu photo' : 'Choose a photo to read'}
          </button>
          {!file && (
            <button
              type="button"
              className={btn('quiet', 'sm')}
              disabled={reading || !canWrite}
              onClick={() => extraPhotoRef.current?.click()}
            >
              Pick a reference image
            </button>
          )}
          <input
            ref={extraPhotoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => readBrand(e.target.files?.[0] ?? null)}
          />
          {extraction && (
            <button type="button" className={btn('ghost', 'sm')} disabled={reading} onClick={() => readBrand(null)}>
              Read again
            </button>
          )}
          {theme && (
            <a
              className={btn('quiet', 'sm')}
              href={`/dashboard/branding/preview?theme=${encodeURIComponent(JSON.stringify(theme))}&name=${encodeURIComponent(name || existingName)}`}
              target="_blank"
              rel="noreferrer"
            >
              Preview the guest menu
            </a>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="border-b border-hair px-4 py-3 text-[12.5px] text-[var(--p-due)] sm:px-5">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="border-b border-hair px-4 py-3 text-[12.5px] text-gink-64 sm:px-5">
          {notice}
        </p>
      )}

      {/* ------------------------------------------------------------- name */}
      <div className="border-b border-hair px-4 py-4 sm:px-5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[12.5px] font-semibold text-gink">Restaurant name</h3>
          {sourceTag(nameResolution.resolved.source)}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} min-w-[220px] flex-1`}
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setNameConfirmed(false);
            }}
            aria-label="Restaurant name"
          />
          <button
            type="button"
            className={btn(nameConfirmed ? 'solid' : 'quiet', 'sm')}
            disabled={!canWrite || name.trim() === ''}
            onClick={() => setNameConfirmed(true)}
          >
            {nameConfirmed ? 'Name confirmed' : 'Use this name'}
          </button>
        </div>
        {!nameConfirmed && (
          <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">
            The name is only applied after you confirm it — the printed spelling is never assumed to be right.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------ logo/banner */}
      <div className="grid gap-4 border-b border-hair px-4 py-4 sm:grid-cols-2 sm:px-5">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[12.5px] font-semibold text-gink">Logo</h3>
            {sourceTag(logoResolution.source)}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border border-hair bg-paper-deep">
              {logoUrl ? (
                <img src={logoUrl} alt="Your logo" className="size-14 object-cover" />
              ) : (
                <span className="text-[13px] font-semibold text-gink-46">
                  {(name || 'A').trim().slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btn('quiet', 'sm')}
                disabled={!canWrite || uploading}
                onClick={() => logoInputRef.current?.click()}
              >
                {logoUrl ? 'Replace logo' : 'Upload logo'}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  className={btn('ghost', 'sm')}
                  onClick={() => {
                    setLogoAssetId(null);
                    setLogoUrl(null);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => upload('logo', e.target.files?.[0] ?? null)}
            />
          </div>
          {extraction?.logoBox && !logoUrl && (
            <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">
              The printed menu carries a mark. It is only a candidate — upload the official logo, or accept
              the printed mark’s crop before publishing.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[12.5px] font-semibold text-gink">Banner</h3>
            {sourceTag(bannerResolution.source)}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-14 w-24 shrink-0 overflow-hidden rounded-[var(--p-r-block)] border border-hair bg-paper-deep">
              {bannerUrl ? (
                <img src={bannerUrl} alt="Your banner" className="h-14 w-24 object-cover" />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btn('quiet', 'sm')}
                disabled={!canWrite || uploading}
                onClick={() => bannerInputRef.current?.click()}
              >
                {bannerUrl ? 'Replace banner' : 'Upload banner'}
              </button>
              {bannerUrl && (
                <button
                  type="button"
                  className={btn('ghost', 'sm')}
                  onClick={() => {
                    setBannerAssetId(null);
                    setBannerUrl(null);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => upload('banner', e.target.files?.[0] ?? null)}
            />
          </div>
          <p className="mt-2 text-[11.5px] leading-[1.5] text-gink-46">Optional — without one the menu uses its paper header.</p>
        </div>
      </div>

      {/* ------------------------------------------------------- conflicts */}
      {openConflicts.map((c) => (
        <div key={conflictKey(c)} className="border-b border-hair px-4 py-3 sm:px-5">
          <p className="text-[12.5px] leading-[1.5] text-gink">{c.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {c.options.map((o) => (
              <button key={o.value} type="button" className={btn('quiet', 'sm')} onClick={() => resolveConflict(c, o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

/** The draft payload shape the parent sends to createImportPairAction. */
export function brandStateToDraft(state: BrandReviewState, importId: string): BrandDraft | null {
  if (!state.theme) return null;
  return {
    importId,
    name: state.name,
    nameConfirmed: state.nameConfirmed,
    theme: state.theme,
    logoAssetId: state.logoAssetId,
    bannerAssetId: state.bannerAssetId,
    provenance: state.provenance,
    conflicts: state.conflicts,
    notes: state.notes,
  };
}
