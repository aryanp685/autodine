/**
 * The storefront status a guest page needs before it renders anything.
 *
 * Separate from getMenuScreenData on purpose: the closed check must answer for
 * a restaurant whose menu the read chain hides, and the announcement rides
 * along so the guest menu fetches one row instead of two.
 */

import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readPublicRestaurant } from '@/lib/db/public-restaurant';

export type StorefrontStatus = {
  name: string;
  /** restaurants.is_active — the column the order gate and the scan gate read. */
  open: boolean;
  /** The announcement banner, when the owner turned it on. Null when not shown. */
  announcement: string | null;
};

export async function getStorefrontStatusBySlug(slug: string): Promise<StorefrontStatus | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await readPublicRestaurant(supabase, slug);

  if (error) throw new Error(`Could not load restaurant: ${error.message}`);
  if (!data) return null;

  return {
    name: String(data.name ?? ''),
    open: data.is_active !== false,
    announcement:
      data.announcement_on === true && data.announcement_text?.trim()
        ? String(data.announcement_text)
        : null,
  };
}
