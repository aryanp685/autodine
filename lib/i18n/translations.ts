/**
 * Menu translations — the rules every surface agrees on.
 *
 * WHAT IS DELIBERATELY NOT HAPPENING HERE
 *
 * A translation never replaces the original. The owner's name and
 * description are the source of truth; each translated version is a
 * separate entry that can be wrong, outdated, or missing without the
 * original ever being touched. A guest whose language has no fresh,
 * approved translation sees the ORIGINAL text — never a blank line and
 * never another language's text wearing this language's label.
 *
 * OUTDATED BY CONSTRUCTION
 *
 * Every entry stores a hash of the source text it was translated from. The
 * moment the owner edits the dish (any path — the editor, bulk add, the
 * importer, the description writer) the hash stops matching and the
 * translation stops showing. No bookkeeping on every save path; the check
 * is the bookkeeping.
 */

/** The languages the menu can be translated into. English originals stay as written. */
export type LanguageCode = 'hi' | 'mr';

/** What the guest picked. 'en' is the menu as the owner wrote it. */
export type GuestLanguage = 'en' | LanguageCode;

export const LANGUAGE_LABELS: Record<GuestLanguage, string> = {
  en: 'EN',
  hi: 'हिन्दी',
  mr: 'मराठी',
};

/** One saved translation of one row (an item or a category). */
export type TranslationEntry = {
  /** Translated name. */
  name: string;
  /** Translated description. '' when the original has none. */
  description: string;
  /** The owner saved (= approved) this. Guests never see unapproved text. */
  approved: boolean;
  /** Hash of the original name + description at translation time. */
  sourceHash: string;
};

/** Language code -> entry. Absent language = not translated. */
export type TranslationMap = Partial<Record<LanguageCode, TranslationEntry>>;

/**
 * FNV-1a over the source text — small, stable, and dependency-free so the
 * same value is computed on the server (at save) and in the browser (at
 * display) without shipping a crypto library to the menu page.
 */
export function sourceHash(name: string, description: string | null | undefined): string {
  const text = `${name}\u0000${description ?? ''}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Is this entry something a guest may see for the CURRENT source text? */
export function isFresh(
  entry: TranslationEntry | undefined,
  name: string,
  description: string | null | undefined
): entry is TranslationEntry {
  return Boolean(entry && entry.approved && entry.sourceHash === sourceHash(name, description));
}

/**
 * The name a guest sees. Falls back to the original — the fallback is the
 * safety, not a gap.
 */
export function translatedName(
  translations: TranslationMap | undefined,
  language: GuestLanguage,
  name: string,
  description: string | null | undefined
): string {
  if (language === 'en') return name;
  const entry = translations?.[language];
  // An empty translated name is a broken entry, not a name: the original
  // shows instead of a blank row.
  return isFresh(entry, name, description) && entry.name.trim() !== '' ? entry.name : name;
}

/** The description a guest sees. Same fallback rule as the name. */
export function translatedDescription(
  translations: TranslationMap | undefined,
  language: GuestLanguage,
  name: string,
  description: string | null | undefined
): string {
  if (language === 'en') return description ?? '';
  const entry = translations?.[language];
  return isFresh(entry, name, description) ? entry.description : description ?? '';
}

/** Does this row offer the guest anything beyond the original in that language? */
export function hasFreshTranslation(
  translations: TranslationMap | undefined,
  language: LanguageCode,
  name: string,
  description: string | null | undefined
): boolean {
  return isFresh(translations?.[language], name, description);
}
