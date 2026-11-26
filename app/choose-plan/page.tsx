import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getStaffContextDetailed } from '@/lib/db/staff';
import { subscriptionStatusOf } from '@/lib/billing/status';
import { ChoosePlanScreen } from '@/components/screens/ChoosePlanScreen';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = {
  title: 'Choose a plan · AutoDine',
  robots: { index: false, follow: false },
};

/** Live billing state; a cached copy could show a trial that has since ended. */
export const dynamic = 'force-dynamic';

/**
 * Where an owner lands from the post-trial wall (and by direct URL).
 *
 * Signed-out visitors belong on /login. A signed-in owner whose account still
 * has time on it is sent straight to the full subscription screen, because
 * there is nothing to decide here. The wall itself is the dashboard gate.
 */
export default async function ChoosePlanPage() {
  const [outlet, context] = await Promise.all([getOutletBar(), getStaffContextDetailed()]);

  if (!outlet) redirect('/login');
  if (!context.ok) redirect('/login');

  const access = context.context.access;
  if (access && subscriptionStatusOf(access) === 'ok') redirect('/dashboard/subscription');

  return (
    <ChoosePlanScreen
      restaurantName={context.context.restaurantName}
      plan={access?.plan ?? 'professional'}
      daysRemaining={access?.daysRemaining ?? 0}
    />
  );
}
