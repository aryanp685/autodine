import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { PlanWelcomeScreen } from '@/components/screens/PlanWelcomeScreen';
import { PLAN_PRICES } from '@/lib/billing/catalog';
import { getSubscriptionScreenData } from '@/lib/db/subscription-screen';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = {
  title: 'Plan confirmed · AutoDine',
  robots: { index: false, follow: false },
};

/**
 * The page Cashfree sends the browser back to.
 *
 * It reads the subscription fresh on every request: the plan is activated by
 * the webhook, which can land a few seconds after the browser, so a cached
 * render would show "confirming" to someone who has already paid.
 */
export const dynamic = 'force-dynamic';

export default async function PlanWelcomePage({
  params,
}: {
  params: Promise<{ plan: string }>;
}) {
  const { plan: planId } = await params;
  const plan = PLAN_PRICES.find((entry) => entry.id === planId);
  if (!plan) notFound();

  const [result] = await Promise.all([getSubscriptionScreenData(getOutletBar)]);
  if (!result.ok) redirect('/login');

  return <PlanWelcomeScreen plan={plan} data={result.data} outlet={result.outlet} />;
}
