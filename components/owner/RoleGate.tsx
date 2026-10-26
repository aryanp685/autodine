/**
 * The door on a staff area.
 *
 * WHY A LAYOUT AND NOT A PROP ON EACH SCREEN
 *
 * Role permissions used to exist in three half-places: the database refused
 * some writes, a few screens disabled their own fields, and nothing at all
 * stopped a kitchen login from opening Settings and reading the tax rate. The
 * result was a product where "your role cannot do this" was discovered by
 * tabbing into a form and pressing Save.
 *
 * A route-level gate makes the answer the same whether the person taps a link
 * or types the address: the area is theirs, or it is not. The rail hides what
 * they cannot open (components/shell-links.ts), this refuses the URL, and the
 * RLS policies refuse the data. Three layers, one story.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not authenticate, and it does not authorise data. `getStaffContext`
 * already resolves the session and the membership; a signed-out or
 * unconfigured request falls through to the page, whose own prompt explains
 * the situation better than a generic wall would. And every write still has to
 * satisfy the database, because a page-level check is a convenience, not a
 * boundary.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, btn } from '@/components/owner/chrome';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { homeForRole, roleLabel } from '@/lib/db/team';

const AREA_NAMES: Record<string, string> = {
  dashboard: 'the dashboard',
  money: 'money and reports',
  menus: 'the menu',
  tables: 'tables and QR codes',
  settings: 'settings',
  counter: 'the counter',
  kitchen: 'the kitchen board',
};

export async function RoleGate({
  allow,
  area,
  children,
}: {
  allow: readonly string[];
  /** The thing being guarded, for the sentence on the wall. */
  area: keyof typeof AREA_NAMES | string;
  children: ReactNode;
}) {
  const staff = await getStaffContextDetailed();

  // No session, no database, no restaurant: not this component's question.
  if (!staff.ok) return <>{children}</>;

  const role = staff.context.role;
  if (allow.includes(role)) return <>{children}</>;

  const home = homeForRole(role as Parameters<typeof homeForRole>[0]);
  const areaName = AREA_NAMES[area] ?? 'this screen';

  return (
    <div className="mx-auto w-full max-w-[560px] py-4">
      <Card className="px-6 py-7">
        <p className="text-[10.5px] font-semibold tracking-[0.12em] text-gink-46 uppercase">
          {roleLabel(role as Parameters<typeof roleLabel>[0])} · no access
        </p>
        <h1 className="mt-2 text-[22px] leading-[1.2] font-medium tracking-[-0.03em] text-gink">
          {areaName.charAt(0).toUpperCase() + areaName.slice(1)} is not part of your role
        </h1>
        <p className="mt-2.5 text-[13px] leading-[1.6] text-gink-64">
          You are signed in as a {roleLabel(role as Parameters<typeof roleLabel>[0])} at{' '}
          {staff.context.restaurantName}. Your role covers your own screens; this one belongs to the
          owner or a manager. Nothing was changed by opening this page.
        </p>
        <p className="mt-2 text-[12.5px] leading-[1.55] text-gink-46">
          If you need access here, ask the owner — they can send you a new invitation with a different
          role from Settings → People.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={home} className={btn('solid', 'md')}>
            Go to your screen
          </Link>
          <Link href="/dashboard/orders" className={btn('ghost', 'md')}>
            Orders
          </Link>
        </div>
      </Card>
    </div>
  );
}
