/**
 * The outlet switcher's data, for the dashboard bar.
 *
 * Kept as its own small loader so each page can ask for it without threading
 * outlet lists through six different screen data types. It resolves the same
 * staff context the page's own loader does -- the extra round trip is the
 * price of not having every screen type learn about outlets, and it is two
 * indexed queries.
 *
 * Returns null when there is no session, no membership, or no database: the
 * bar then renders without a switcher, which is the honest state in demo mode.
 */

import { getStaffContextDetailed } from './staff';
import type { OutletBar } from '../outlets';

export async function getOutletBar(): Promise<OutletBar | null> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return null;

  return { outlets: staff.context.outlets, activeId: staff.context.restaurantId };
}
