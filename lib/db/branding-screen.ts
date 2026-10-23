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
  sampleDishes: { id: string; name: string; price: number; img: string | null }[];
  /** False when nothing is published: the preview then says so. */
  hasPublishedMenu: boolean;
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
      hasPublishedMenu: false,
      blocked: staff.reason,
    };
  }

  const { supabase, restaurantId, role, slug, restaurantName, tagline } = staff.context;

  const [restaurant, menus, dishes] = await Promise.all([
    supabase
      .from('restaurants')
      .select('logo_path, banner_path')
      .eq('id', restaurantId)
      .maybeSingle(),
    supabase.from('menus').select('id, is_published').eq('restaurant_id', restaurantId),
    supabase
      .from('items')
      .select('id, name, price_paise, image_url, is_available')
      .eq('restaurant_id', restaurantId)
      .order('sort_order', { ascending: true })
      .limit(4),
  ]);

  const row = (restaurant.data ?? {}) as {
    logo_path?: string | null;
    banner_path?: string | null;
  };

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
      img: publicAssetUrl((d.image_url as string | null) ?? null),
    })),
    hasPublishedMenu: (menus.data ?? []).some((m) => m.is_published === true),
  };
}
