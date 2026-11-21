import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SubscriptionScreen } from '@/components/screens/SubscriptionScreen';
import { getSubscriptionScreenData } from '@/lib/db/subscription-screen';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = {
  title: 'Subscription · AutoDine',
  robots: { index: false, follow: false },
};

/**
 * The subscription is a money screen and a live one: a cached copy could show
 * an owner a plan they no longer have or a trial that has since ended.
 */
export const dynamic = 'force-dynamic';

export default async function SubscriptionPage() {
  const [result] = await Promise.all([getSubscriptionScreenData(getOutletBar)]);

  if (!result.ok) {
    // Not configured, or no membership. Both are answered by signing in, never
    // by rendering a subscription page full of invented numbers.
    redirect('/login');
  }

  return <SubscriptionScreen data={result.data} outlet={result.outlet} />;
}
