/**
 * Which menu a guest is looking at.
 *
 * A restaurant can publish more than one menu -- breakfast, lunch, the
 * evening a-la-carte, a festival sheet -- and each one is a separate list of
 * categories sitting under its own row in `menus`. Until now the app took the
 * first published menu and then loaded every category and dish in the
 * restaurant, so a two-menu venue showed both menus merged into one list, in
 * which half the dishes could not actually be ordered: the ordering function
 * insisted every line belonged to the one menu it had picked for itself.
 *
 * The fix is that a menu is chosen explicitly and everything downstream -- the
 * categories, the dishes and the order -- is scoped to that choice. This file
 * is the one place that decides which menu that is, so the rule cannot drift
 * between the page, the API and the editor.
 *
 * The rule: the menu asked for, if it is one of the published ones; otherwise
 * the first in the restaurant's own order (sort_order, then oldest first).
 * Never "the newest" -- a restaurant that adds next month's festival menu must
 * not silently change what a guest sees today.
 */

export type MenuLike = { id: string; name: string };

/**
 * Pick the menu to show.
 *
 * `wanted` comes from the URL, so it is untrusted: an id for a draft menu, or
 * for another restaurant's menu, must not be honoured. Both cases fall back to
 * the default rather than erroring -- a stale link should still show the
 * restaurant's live menu, not a blank page.
 */
export function chooseMenu<T extends MenuLike>(menus: T[], wanted?: string | null): T | null {
  if (menus.length === 0) return null;

  const asked = wanted?.trim();
  if (asked) {
    const match = menus.find((menu) => menu.id === asked);
    if (match) return match;
  }

  return menus[0];
}
