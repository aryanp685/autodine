import { randomUUID } from 'node:crypto';
import { BtnLink, Notice, OwnerPage, PageHead } from '@/components/owner/chrome';
import { getStaffContextDetailed, CASHIER_ROLES } from '@/lib/db/staff';
import { getRestaurantMenu } from '@/lib/db/menu';
import { DirectTicketForm } from '@/components/owner/DirectTicketForm';

export const dynamic = 'force-dynamic';

export default async function DirectOrderPage() {
  const staff = await getStaffContextDetailed();
  const ctx = staff.ok ? staff.context : null;
  const allowed = ctx && CASHIER_ROLES.includes(ctx.role) && ctx.entitlement?.canWrite;
  let menu = null;
  if (allowed) {
    try { menu = await getRestaurantMenu(ctx.slug); } catch { /* no demo menu on a write route */ }
  }
  const items = menu?.restaurant.id === ctx?.restaurantId ? menu?.items ?? [] : [];
  return <OwnerPage active="overview" signOut>
    <PageHead kicker="Counter billing" title="Direct takeaway or delivery" meta={ctx?.restaurantName} />
    <BtnLink href="/dashboard" tone="quiet">Back to billing sessions</BtnLink>
    {allowed && items.length > 0 ? <DirectTicketForm outlet={ctx.restaurantId} attempt={randomUUID()} items={items} />
      : <Notice tone="due" label="Not available">Counter access, write entitlement and a published menu for this outlet are required.</Notice>}
  </OwnerPage>;
}
