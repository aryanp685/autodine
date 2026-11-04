/**
 * The one function that decides how a guest menu is painted.
 *
 * THE CONTRACT (and the reason this file is small):
 *
 *   - A restaurant with no published brand profile — every restaurant that
 *     has never opened the Brand Studio — gets EXACTLY the product's own
 *     guest style: guestAccentStyle(), a constant, unchanged since the
 *     "every customer sees the same UI" decision.
 *   - A restaurant that published a brand profile (restaurants.
 *     brand_theme_enabled = true, written only by publish_menu_brand_pair)
 *     gets the same design system re-painted from its validated theme:
 *     colour, typography character, card geometry, motifs.
 *
 * No component reads a theme column directly (lib/guest-design.test.ts
 * enforces that screens never touch per-restaurant colour). Everything comes
 * through here, so there is exactly one place where "opted in or not" lives.
 *
 * A theme that fails to parse is treated as no theme: the guest menu must not
 * break over a value it does not recognise.
 */

import { guestAccentStyle } from './palette';
import { parseTheme, themeDataAttrs, themeGuestStyle, type BrandTheme } from './theme';

export type GuestBrandState = {
  /** restaurants.brand_theme_enabled */
  brandThemeEnabled?: boolean | null;
  /** restaurants.brand_theme — validated JSON, or anything at all. */
  brandTheme?: unknown | null;
};

export type GuestBrandStyle = {
  style: Record<string, string>;
  /** Attributes for the [data-flow-root] element (data-brand, data-motif…). */
  attrs: Record<string, string>;
  /** Non-null only when a theme is actually being applied. */
  theme: BrandTheme | null;
};

/**
 * Resolve the paint for one restaurant. Pure; safe on the client.
 */
export function guestBrandStyle(restaurant: GuestBrandState | null | undefined): GuestBrandStyle {
  const theme =
    restaurant?.brandThemeEnabled === true ? parseTheme(restaurant.brandTheme ?? null) : null;

  if (!theme) {
    return { style: guestAccentStyle(), attrs: {}, theme: null };
  }
  return { style: themeGuestStyle(theme), attrs: themeDataAttrs(theme), theme };
}
