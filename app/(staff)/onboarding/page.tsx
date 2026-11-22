import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { getStaffContext } from '@/lib/db/staff';
import { getOnboardingSteps, isOnboardingComplete, resolveStepIndex } from '@/lib/onboarding';

export const metadata: Metadata = {
  title: 'Set up your restaurant · AutoDine',
  robots: { index: false, follow: false },
};

/**
 * The onboarding wizard entry point.
 *
 * WHY IT READS THROUGH getStaffContext
 *
 * `getStaffContext()` resolves the caller's restaurant from their session
 * membership and, inside it, reads `restaurant_access()` via `loadAccess()`
 * (lib/db/staff.ts). The restaurant id is never taken from the URL or a form,
 * so a forged link cannot point the wizard at someone else's outlet. When the
 * database is unconfigured or the caller has no membership, the context is null
 * and the wizard still renders — a read-only shell that writes nothing, which
 * is the safe default for a skeleton.
 *
 * If the restaurant is already onboarded (writable, not read-only), the owner
 * is sent to the dashboard: showing setup to a finished restaurant would be a
 * step backwards. `isOnboardingComplete` is a rendering hint only — the
 * database stays the authority for every write a real step performs.
 *
 * The active step is chosen from `?step=` (an id or a 1-based number) and
 * clamped to the sequence, so a stale or crafted URL can never render a blank
 * wizard or reach past the last step.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const [{ step }, context] = await Promise.all([searchParams, getStaffContext()]);

  const steps = getOnboardingSteps();
  const currentIndex = resolveStepIndex(step);

  if (isOnboardingComplete(context?.access ?? null)) {
    redirect('/dashboard');
  }

  return <OnboardingWizard steps={steps} currentIndex={currentIndex} />;
}