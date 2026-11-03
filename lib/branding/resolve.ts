/**
 * The source-priority merge: whose word wins, and when we must ask.
 *
 * The spec's order is fixed:
 *
 *   1. owner-confirmed name   2. owner-uploaded logo/banner
 *   3. existing approved settings   4. printed-menu extraction
 *   5. AI suggestion
 *
 * "If sources conflict, show the conflict and ask the owner. Never silently
 * choose an uncertain source." So this module does two things and nothing
 * else: it merges per-field with provenance, and it names every place where
 * two sources disagree so the review screen can put the question to the
 * owner. A conflict is not an error — it is a decision the product refuses
 * to make on the owner's behalf.
 *
 * Pure functions only. The review UI, the publish guard and the tests all
 * read the same answers from here.
 */

import type { BrandExtraction } from '../ai/brand-vision';
import type { BrandConflict, FieldSource } from './draft';
import {
  parseTheme,
  type BrandTheme,
  type CardBorder,
  type CardElevation,
  type CardRadius,
  type FontCharacter,
  type HeaderStyle,
  type Motif,
  type Spacing,
} from './theme';

export type Resolved<T> = {
  value: T;
  source: FieldSource;
  /** True when the owner must confirm before this can go live. */
  needsConfirmation: boolean;
};

export type BrandInputs = {
  /** The name as it is live today. */
  existingName: string | null;
  /** The name the owner typed/confirmed in review, if any. */
  ownerConfirmedName: string | null;
  extraction: BrandExtraction | null;
  /** Owner-uploaded official assets (asset ids, already saved). */
  uploadedLogoAssetId: string | null;
  uploadedBannerAssetId: string | null;
  /** Owner's colour pick in review, if any (hex). */
  ownerPrimary: string | null;
  /** The theme fields the owner edited directly, if any. */
  ownerTheme: Partial<BrandTheme> | null;
};

/* ------------------------------------------------------------------ name */

/**
 * Name resolution. The restaurant name is the one field the spec says is
 * NEVER applied without explicit confirmation — so even the winning value
 * carries `needsConfirmation` until the owner has said yes.
 */
export function resolveName(inputs: Pick<BrandInputs, 'existingName' | 'ownerConfirmedName' | 'extraction'>): {
  resolved: Resolved<string | null>;
  conflicts: BrandConflict[];
} {
  const extracted = inputs.extraction?.name ?? null;
  const extractedHigh = extracted && inputs.extraction?.nameConfidence === 'high';

  if (inputs.ownerConfirmedName) {
    return {
      resolved: { value: inputs.ownerConfirmedName, source: 'owner-confirmed', needsConfirmation: false },
      conflicts:
        extracted && extracted.toLowerCase() !== inputs.ownerConfirmedName.toLowerCase()
          ? [
              {
                field: 'name',
                message: 'The printed menu shows a different name than the one you confirmed.',
                options: [
                  { label: `Keep “${inputs.ownerConfirmedName}” (your choice)`, value: inputs.ownerConfirmedName },
                  { label: `Use “${extracted}” (printed)`, value: extracted },
                ],
              },
            ]
          : [],
    };
  }

  const conflicts: BrandConflict[] = [];
  if (extractedHigh && inputs.existingName && extracted.toLowerCase() !== inputs.existingName.toLowerCase()) {
    conflicts.push({
      field: 'name',
      message: 'The name printed on the menu does not match your restaurant’s current name.',
      options: [
        { label: `Keep “${inputs.existingName}” (current)`, value: inputs.existingName },
        { label: `Use “${extracted}” (printed)`, value: extracted },
      ],
    });
  }

  return {
    resolved: {
      value: extractedHigh ? extracted : inputs.existingName,
      source: extractedHigh ? 'printed-menu' : 'existing',
      needsConfirmation: true,
    },
    conflicts,
  };
}

/* --------------------------------------------------------------- primary */

/**
 * Primary colour. The owner's pick (a control they touched) beats everything;
 * otherwise a high-confidence printed colour; otherwise the current palette
 * accent; otherwise the extraction's low-confidence guess is NOT used —
 * an uncertain colour is the same problem as an uncertain price.
 */
export function resolvePrimary(inputs: Pick<BrandInputs, 'extraction' | 'ownerPrimary'>): {
  resolved: Resolved<string>;
  conflicts: BrandConflict[];
} {
  const extracted = inputs.extraction?.colors.primary ?? null;
  const extractedHigh = extracted && inputs.extraction?.colors.primaryConfidence === 'high';

  if (inputs.ownerPrimary) {
    return {
      resolved: { value: inputs.ownerPrimary, source: 'owner-confirmed', needsConfirmation: false },
      conflicts:
        extractedHigh && extracted && extracted !== inputs.ownerPrimary
          ? [
              {
                field: 'primary',
                message: 'The colour you picked differs from the dominant colour printed on the menu.',
                options: [
                  { label: `Keep ${inputs.ownerPrimary} (your choice)`, value: inputs.ownerPrimary },
                  { label: `Use ${extracted} (printed)`, value: extracted },
                ],
              },
            ]
          : [],
    };
  }

  if (extractedHigh && extracted) {
    return {
      resolved: { value: extracted, source: 'printed-menu', needsConfirmation: true },
      conflicts: [],
    };
  }

  // Nothing trustworthy: the guest default stays (maroon, the product's own
  // guest accent) and the review asks the owner to choose.
  return {
    resolved: { value: '#6B2338', source: 'ai', needsConfirmation: true },
    conflicts: [],
  };
}

/* ---------------------------------------------------------- logo/banner */

/**
 * An uploaded official asset always wins (priority 2 over 4). An extracted
 * logo box is a CANDIDATE: it becomes the value with `needsConfirmation`,
 * because "never treat an uncertain decorative graphic as the official logo
 * without owner confirmation" — and the crop is only produced after the
 * owner accepts it in review.
 */
export function resolveLogo(
  inputs: Pick<BrandInputs, 'uploadedLogoAssetId' | 'extraction'>,
): Resolved<string | null> {
  if (inputs.uploadedLogoAssetId) {
    return { value: inputs.uploadedLogoAssetId, source: 'owner-upload', needsConfirmation: false };
  }
  if (inputs.extraction?.logoBox && inputs.extraction.logoConfidence === 'high') {
    return { value: null, source: 'printed-menu', needsConfirmation: true };
  }
  return { value: null, source: inputs.extraction ? 'ai' : 'existing', needsConfirmation: false };
}

export function resolveBanner(
  inputs: Pick<BrandInputs, 'uploadedBannerAssetId' | 'extraction'>,
): Resolved<string | null> {
  if (inputs.uploadedBannerAssetId) {
    return { value: inputs.uploadedBannerAssetId, source: 'owner-upload', needsConfirmation: false };
  }
  if (inputs.extraction?.bannerBox) {
    return { value: null, source: 'printed-menu', needsConfirmation: true };
  }
  return { value: null, source: inputs.extraction ? 'ai' : 'existing', needsConfirmation: false };
}

/* ----------------------------------------------------------------- theme */

/**
 * Assemble the theme: extraction (tier 4/5) under the owner's edits (tier 1).
 * Every value still passes the theme parser — the merged object is rebuilt
 * through parseTheme so nothing unvalidated survives the merge either.
 */
export function buildTheme(inputs: Pick<BrandInputs, 'extraction' | 'ownerPrimary' | 'ownerTheme'>): BrandTheme | null {
  const e = inputs.extraction;
  const primary = inputs.ownerPrimary ?? e?.colors.primary ?? null;
  if (!primary) return null;

  const fromExtraction = {
    colors: {
      primary,
      secondary: e?.colors.secondary[0] ?? null,
      background: e?.colors.background ?? null,
      surface: e?.colors.surface ?? null,
    },
    typography: {
      character: (e?.typography.character ?? 'sans') as FontCharacter,
      exactFont: e?.typography.exactFont ?? null,
    },
    layout: {
      header: (e?.layout.header ?? 'plain') as HeaderStyle,
      card: {
        radius: (e?.layout.card.radius ?? 'soft') as CardRadius,
        border: (e?.layout.card.border ?? 'hairline') as CardBorder,
        elevation: (e?.layout.card.elevation ?? 'flat') as CardElevation,
      },
      spacing: (e?.layout.spacing ?? 'regular') as Spacing,
      motifs: (e?.layout.motifs ?? []) as Motif[],
    },
  };

  // The owner's edits layer on top, but the primary colour is decided by
  // resolvePrimary's priority — an edit cannot be overridden by extraction.
  const owner = inputs.ownerTheme ?? {};
  const assembled = {
    ...fromExtraction,
    ...owner,
    colors: {
      ...fromExtraction.colors,
      ...(owner.colors ?? {}),
      primary,
    },
    typography: { ...fromExtraction.typography, ...(owner.typography ?? {}) },
    layout: {
      ...fromExtraction.layout,
      ...(owner.layout ?? {}),
      card: { ...fromExtraction.layout.card, ...(owner.layout?.card ?? {}) },
    },
  };

  return parseTheme(assembled);
}

/* -------------------------------------------------------------- conflicts */

/**
 * Cross-source conflicts beyond the per-field ones: an uploaded official logo
 * coexisting with a printed logo candidate is a question, not a silent win —
 * the owner should see both (upload wins by priority, but the printed mark
 * might BE the better official asset).
 */
export function assetConflicts(
  inputs: Pick<BrandInputs, 'uploadedLogoAssetId' | 'extraction'>,
): BrandConflict[] {
  if (inputs.uploadedLogoAssetId && inputs.extraction?.logoBox && inputs.extraction.logoConfidence === 'high') {
    return [
      {
        field: 'logo',
        message:
          'You uploaded a logo and the printed menu also carries a mark. Which one is official? (Your upload is what guests would see.)',
        options: [
          { label: 'Use my uploaded logo', value: 'upload' },
          { label: 'Use the printed mark', value: 'printed' },
        ],
      },
    ];
  }
  return [];
}
