/**
 * The brand state for one restaurant, for the guest routes.
 *
 * One narrow query (two columns) that every guest screen's route can afford:
 * the theme is applied through lib/branding/guest-theme.ts, and this module
 * only fetches the two facts that decision needs. A restaurant with no
 * published profile answers `{ brandThemeEnabled: false }` and the screen
 * paints the product's own style — the default, not a fallback.
 */

import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { GuestBrandState } from './guest-theme';
import { readPublicRestaurant } from '@/lib/db/public-restaurant';

export async function getGuestBrandState(slug?: string | null): Promise<GuestBrandState | null> {
  const target = slug?.trim() ?? '';
  if (!isSupabaseConfigured || !target) return null;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await readPublicRestaurant(supabase, target);

  // A failed brand read must never take the menu down: no theme is the
  // designed default and the guest still orders.
  if (error || !data || !data.is_active) return null;
  return {
    brandThemeEnabled: data.brand_theme_enabled === true,
    brandTheme: data.brand_theme ?? null,
  };
}
