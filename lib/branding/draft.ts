/**
 * The brand draft: what the owner reviews, and what is allowed to be saved.
 *
 * The extraction, the review screen and the database row disagree about
 * shapes by default — a model returns what it likes, a browser posts what it
 * likes, and a column accepts what it is given. This module is the one place
 * that decides what a brand draft IS:
 *
 *   sanitiseBrandDraft() takes anything and returns either a draft the
 *   database is allowed to hold, or null. It runs on the server, again, even
 *   though the server produced the shape — the same rule as
 *   lib/menu-import.ts's sanitiseDraft: this payload crossed a network.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No free-text CSS, no URLs inside the draft, no array without a cap. The
 * theme half is delegated to lib/branding/theme.ts (enums + parsed hexes
 * only), and asset references are UUIDs checked against the caller's own
 * restaurant at save time.
 */

import { parseTheme, type BrandTheme } from './theme';

/** Where a value came from, in the spec's priority order (1 = highest). */
export type FieldSource = 'owner-confirmed' | 'owner-upload' | 'existing' | 'printed-menu' | 'ai';

export const SOURCE_PRIORITY: readonly FieldSource[] = [
  'owner-confirmed',
  'owner-upload',
  'existing',
  'printed-menu',
  'ai',
];

export type BrandConflict = {
  field: 'name' | 'primary' | 'logo' | 'banner';
  message: string;
  options: { label: string; value: string }[];
};

export type BrandDraft = {
  /** Stable import identifier shared with the menu draft. */
  importId: string;
  /** The restaurant name as it should go live. Null = leave the name alone. */
  name: string | null;
  /** The owner explicitly confirmed the name. Publish refuses without it. */
  nameConfirmed: boolean;
  theme: BrandTheme;
  logoAssetId: string | null;
  bannerAssetId: string | null;
  provenance: Partial<Record<'name' | 'primary' | 'logo' | 'banner' | 'theme', FieldSource>>;
  conflicts: BrandConflict[];
  /** Model-authored caveats shown in review ("the logo box was uncertain"). */
  notes: string[];
};

export const MAX_NAME = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function cleanUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function cleanSource(value: unknown): FieldSource | null {
  return typeof value === 'string' && (SOURCE_PRIORITY as readonly string[]).includes(value)
    ? (value as FieldSource)
    : null;
}

/**
 * Anything → a saveable draft, or null.
 *
 * A draft with no valid theme is not a draft: without a primary colour there
 * is nothing to render, and a half-shaped row would surface later as a
 * broken menu rather than a refused save.
 */
export function sanitiseBrandDraft(input: unknown): BrandDraft | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const theme = parseTheme(raw.theme);
  if (!theme) return null;

  const importId = cleanUuid(raw.importId);
  if (!importId) return null;

  const provenanceRaw = (raw.provenance ?? {}) as Record<string, unknown>;
  const provenance: BrandDraft['provenance'] = {};
  for (const key of ['name', 'primary', 'logo', 'banner', 'theme'] as const) {
    const source = cleanSource(provenanceRaw[key]);
    if (source) provenance[key] = source;
  }

  const conflictsRaw = Array.isArray(raw.conflicts) ? raw.conflicts : [];
  const conflicts: BrandConflict[] = [];
  for (const entry of conflictsRaw.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const field = cleanText(c.field, 20);
    if (field !== 'name' && field !== 'primary' && field !== 'logo' && field !== 'banner') continue;
    const message = cleanText(c.message, 240);
    if (!message) continue;
    const options = (Array.isArray(c.options) ? c.options : [])
      .slice(0, 4)
      .map((o) => {
        const opt = (o ?? {}) as Record<string, unknown>;
        const label = cleanText(opt.label, 60);
        const value = cleanText(opt.value, 240);
        return label && value ? { label, value } : null;
      })
      .filter((o): o is { label: string; value: string } => o !== null);
    conflicts.push({ field, message, options });
  }

  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .map((n) => cleanText(n, 240))
    .filter((n): n is string => n !== null)
    .slice(0, 6);

  return {
    importId,
    name: cleanText(raw.name, MAX_NAME),
    nameConfirmed: raw.nameConfirmed === true,
    theme,
    logoAssetId: cleanUuid(raw.logoAssetId),
    bannerAssetId: cleanUuid(raw.bannerAssetId),
    provenance,
    conflicts,
    notes,
  };
}

/**
 * What goes into `restaurant_brand_profiles.theme` / `.source`.
 * The theme column holds exactly the parsed theme — nothing else fits
 * through parseTheme — and the source column holds provenance, conflicts and
 * notes as plain JSON the review screen can rebuild from.
 */
export function draftToRow(draft: BrandDraft): { theme: BrandTheme; source: Record<string, unknown> } {
  return {
    theme: draft.theme,
    source: {
      provenance: draft.provenance,
      conflicts: draft.conflicts,
      notes: draft.notes,
      nameConfirmed: draft.nameConfirmed,
    },
  };
}

/** The inverse: rebuild review state from a stored row. */
export function rowToDraft(
  row: {
    import_id: string;
    name: string | null;
    theme: unknown;
    source: unknown;
    logo_asset_id: string | null;
    banner_asset_id: string | null;
  },
): BrandDraft | null {
  const theme = parseTheme(row.theme);
  if (!theme) return null;
  const source = (row.source ?? {}) as Record<string, unknown>;
  return sanitiseBrandDraft({
    importId: row.import_id,
    name: row.name,
    nameConfirmed: source.nameConfirmed === true,
    theme,
    logoAssetId: row.logo_asset_id,
    bannerAssetId: row.banner_asset_id,
    provenance: source.provenance,
    conflicts: source.conflicts,
    notes: source.notes,
  });
}
