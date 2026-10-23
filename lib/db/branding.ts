/**
 * The branding every guest screen needs, fetched once per request.
 *
 * WHY A SEPARATE QUERY
 *
 * The menu page already loads the restaurant row and gets branding for free.
 * The cart, checkout and order screens do not: they load only the restaurant's
 * NAME (see lib/db/cart-screen.ts), because that is all they ever rendered.
 * Threading branding through those loaders would mean touching three data
 * modules and their types to add four fields; one narrow query that returns
 * exactly the branding is smaller, and React's `cache` makes it free when two
 * components in the same request ask for it.
 *
 * WHY IT CANNOT LEAK BETWEEN RESTAURANTS
 *
 * It takes the SLUG the guest already used, and `restaurants` is readable by
 * anon only for active rows. It returns no id, no address, no money -- three
 * display values and a palette key.
 */

import { cache } from 'react';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { publicAssetUrl } from '@/lib/storage/assets';

export type GuestBranding = {
  logoUrl: string | null;
  bannerUrl: string | null;
  /** A palette key, not a colour. See lib/branding/palette.ts. */
  accent: string;
};

import { DEFAULT_ACCENT } from '@/lib/branding/palette';

export const NO_BRANDING: GuestBranding = {
  logoUrl: null,
  bannerUrl: null,
  // The one place a missing accent is decided. It reads the palette's default
  // rather than repeating the key, so changing the default cannot leave this
  // constant pointing at a colour the product no longer prefers.
  accent: DEFAULT_ACCENT,
};

/**
 * Branding for one restaurant, by public slug.
 *
 * Returns NO_BRANDING -- never null -- when Supabase is unconfigured, the slug
 * is missing, the row is gone, or the columns do not exist yet because the
 * migration has not been applied. Every one of those is a page that must still
 * render, and the menu's fallback header is designed for exactly this case.
 */
export const getGuestBranding = cache(async (slug?: string | null): Promise<GuestBranding> => {
  const target = slug?.trim();
  if (!isSupabaseConfigured || !target) return NO_BRANDING;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NO_BRANDING;

  const { data, error } = await supabase
    .from('restaurants')
    .select('logo_path, banner_path, accent')
    .eq('slug', target)
    .maybeSingle();

  if (error || !data) {
    // A missing column (migration not yet applied) and a missing row look the
    // same to the guest: an unbranded but working menu. Logged so an operator
    // can tell the difference.
    if (error) console.error(`[branding] could not read branding for "${target}": ${error.message}`);
    return NO_BRANDING;
  }

  const row = data as { logo_path?: string | null; banner_path?: string | null; accent?: string | null };

  return {
    logoUrl: publicAssetUrl(row.logo_path),
    bannerUrl: publicAssetUrl(row.banner_path),
    accent: row.accent?.trim() || DEFAULT_ACCENT,
  };
});
