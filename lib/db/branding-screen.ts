/**
 * Load the Branding screen.
 *
 * Same security shape as Settings: the restaurant id comes from the caller's
 * membership row through the shared staff context, never from a slug or a form
 * field. Branding is a write surface, so a wrong restaurant here would mean
 * painting one venue's menu with another's logo.
 *
 * Returns null only when Supabase is not configured. A configured but blocked
 * caller gets `blocked` and must be shown a sign-in prompt rather than a form
 * with empty fields -- an empty branding form reads as "my logo was deleted".
 */

import { getStaffContextDetailed } from '@/lib/db/staff';
import { publicAssetUrl } from '@/lib/storage/assets';
import { designCandidates, currentDesignIdOf, type DesignCandidate, type DesignId } from '@/lib/branding/designs';
import { parseTheme } from '@/lib/branding/theme';
import { qrSvg, siteOrigin } from '@/lib/qr';

/** One outlet as a storefront: link, code, and whether guests can use it. */
export type StorefrontRow = {
  id: string;
  name: string;
  slug: string;
  /** The outlet this dashboard is editing right now. */
  isCurrent: boolean;
  /** restaurants.is_active — the ordering status. */
  open: boolean;
  /** At least one menu is published, so the link shows dishes. */
  published: boolean;
  url: string;
  /** A real scannable code for `url`, or null if it could not be drawn. */
  qr: string | null;
};

export type BrandingScreenData = {
  role: string;
  /** Owner or manager. Decided here so the screen can disable what RLS refuses. */
  canEdit: boolean;
  name: string;
  tagline: string;
  slug: string;
  /** Resolved public URLs, or null when nothing has been uploaded. */
  logoUrl: string | null;
  bannerUrl: string | null;
  /** The stored path, needed to delete the object when replacing it. */
  logoPath: string | null;
  bannerPath: string | null;
  /** A few real dishes, so the preview shows this restaurant's own menu. */
  sampleDishes: {
    id: string;
    name: string;
    price: number;
    pricePaise: number;
    category: string;
    img: string | null;
  }[];
  /**
   * The two storefront designs, built from the restaurant's own colours (or
   * the product default before any brand exists). The screen's design
   * section previews and applies these — the same candidates the import
   * offered, so a design picked later looks exactly like its preview.
   */
  designs: DesignCandidate[];
  /** Which of the two the live/draft theme currently is. Null = the owner's own. */
  currentDesignId: DesignId | null;
  /** False when nothing is published: the preview then says so. */
  hasPublishedMenu: boolean;
  /**
   * The published brand state (migration 20261103000100). The preview paints
   * through lib/branding/guest-theme.ts with exactly these facts, so what the
   * owner sees here is what the guest sees.
   */
  brand?: { brandThemeEnabled?: boolean | null; brandTheme?: unknown | null } | null;
  /** A publish/rollback pair exists to restore (migration 20261103000100). */
  hasPublishHistory?: boolean;
  /** A brand draft is waiting — imported but not published yet. */
  hasDraft?: boolean;
  /** The announcement banner: one line, shown on the guest menu while on. */
  announcement: { on: boolean; text: string };
  /** False when the storefront is closed (restaurants.is_active). */
  orderingOpen: boolean;
  /**
   * Every outlet on this account, as storefronts: the guest link, the code
   * and the live status. More than one row only when the account really has
   * several outlets — the section is about chains, not about the one shop.
   */
  storefronts: StorefrontRow[];
  blocked?: 'signed-out' | 'no-membership';
};

export async function getBrandingScreenData(): Promise<BrandingScreenData | null> {
  const staff = await getStaffContextDetailed();

  if (!staff.ok) {
    if (staff.reason === 'unconfigured') return null;
    return {
      role: '',
      canEdit: false,
      name: '',
      tagline: '',
      slug: '',
      logoUrl: null,
      bannerUrl: null,
      logoPath: null,
      bannerPath: null,
      sampleDishes: [],
      designs: [],
      currentDesignId: null,
      hasPublishedMenu: false,
      hasDraft: false,
      announcement: { on: false, text: '' },
      orderingOpen: true,
      storefronts: [],
      blocked: staff.reason,
    };
  }

  const { supabase, restaurantId, role, slug, restaurantName, tagline } = staff.context;

  const [restaurant, menus, dishes, history, dishCategories, draft] = await Promise.all([
    supabase
      .from('restaurants')
      .select('logo_path, banner_path, brand_theme_enabled, brand_theme, is_active, announcement_text, announcement_on')
      .eq('id', restaurantId)
      .maybeSingle(),
    supabase.from('menus').select('id, is_published').eq('restaurant_id', restaurantId),
    supabase
      .from('items')
      .select('id, name, price_paise, image_url, is_available, category_id')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true })
      .limit(4),
    supabase
      .from('restaurant_publish_history')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId),
    // Category names for the sample dishes, so the design previews label
    // rows the way the guest menu does.
    supabase.from('categories').select('id, name').eq('restaurant_id', restaurantId),
    // The pending brand draft, if any: while nothing is live it is the theme
    // the first publish would carry, so it colours the previews and marks the
    // current pick.
    supabase
      .from('restaurant_brand_profiles')
      .select('id, theme')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const row = (restaurant.data ?? {}) as {
    logo_path?: string | null;
    banner_path?: string | null;
    brand_theme_enabled?: boolean | null;
    brand_theme?: unknown | null;
    is_active?: boolean | null;
    announcement_text?: string | null;
    announcement_on?: boolean | null;
  };

  const categoryNameById = new Map(
    ((dishCategories.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );

  // The base for the design candidates: the live theme when one is painted,
  // else nothing (the product default colours). While a menu is live a draft
  // theme never colours the candidates — the previews must show what guests
  // see now. With nothing live yet the pending draft's own colours are the
  // base, because that is what the first publish would show.
  const draftRow = (draft.data ?? null) as { id: string; theme?: unknown } | null;
  const hasPublishedMenu = (menus.data ?? []).some((m) => m.is_published === true);

  // Every outlet this account belongs to, as a storefront. Two small reads
  // and one code per outlet: the fields are the same ones the active-outlet
  // sections above already read, gathered across the account instead of one.
  const outletIds = staff.context.outlets.map((o) => o.id);
  const [outletRows, outletMenus] = await Promise.all([
    supabase
      .from('restaurants')
      .select('id, name, slug, is_active')
      .in('id', outletIds)
      .order('name', { ascending: true }),
    supabase.from('menus').select('restaurant_id, is_published').in('restaurant_id', outletIds),
  ]);
  const publishedOutletIds = new Set(
    ((outletMenus.data ?? []) as { restaurant_id: string; is_published: boolean | null }[])
      .filter((m) => m.is_published === true)
      .map((m) => m.restaurant_id)
  );
  const origin = await siteOrigin();
  const storefronts: StorefrontRow[] = await Promise.all(
    ((outletRows.data ?? []) as { id: string; name: string | null; slug: string | null; is_active: boolean | null }[]).map(
      async (row) => {
        const slug = String(row.slug ?? '');
        const url = `${origin.replace(/\/+$/, '')}/menu?s=${encodeURIComponent(slug)}`;
        return {
          id: String(row.id),
          name: String(row.name ?? ''),
          slug,
          isCurrent: row.id === restaurantId,
          open: row.is_active !== false,
          published: publishedOutletIds.has(String(row.id)),
          url,
          qr: slug ? await qrSvg(url) : null,
        };
      }
    )
  );
  const liveBase = row.brand_theme_enabled === true ? parseTheme(row.brand_theme) : null;
  const draftBase = !hasPublishedMenu && draftRow ? parseTheme(draftRow.theme ?? null) : null;
  const baseTheme = liveBase ?? draftBase;
  const designs = designCandidates(baseTheme);

  return {
    role,
    canEdit: role === 'owner' || role === 'manager',
    name: restaurantName,
    tagline: tagline ?? '',
    slug,
    logoPath: row.logo_path ?? null,
    bannerPath: row.banner_path ?? null,
    logoUrl: publicAssetUrl(row.logo_path),
    bannerUrl: publicAssetUrl(row.banner_path),
    sampleDishes: (dishes.data ?? []).map((d) => ({
      id: String(d.id),
      name: String(d.name),
      price: Math.round(Number(d.price_paise ?? 0) / 100),
      pricePaise: Number(d.price_paise ?? 0),
      category: categoryNameById.get((d.category_id as string | null) ?? '') ?? '',
      img: publicAssetUrl((d.image_url as string | null) ?? null),
    })),
    designs,
    currentDesignId: currentDesignIdOf(baseTheme),
    hasPublishedMenu,
    hasDraft: draftRow !== null,
    announcement: {
      on: row.announcement_on === true && Boolean(row.announcement_text?.trim()),
      text: row.announcement_text ?? '',
    },
    orderingOpen: row.is_active !== false,
    storefronts,
    hasPublishHistory: (history.count ?? 0) > 0,
    brand: {
      brandThemeEnabled: row.brand_theme_enabled === true,
      brandTheme: row.brand_theme ?? null,
    },
  };
}
