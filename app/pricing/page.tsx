import type { Metadata } from 'next';
import { PricingScreen } from '@/components/screens/PricingScreen';
import { TRIAL_DAYS } from '@/lib/trial';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readPublicRestaurant } from '@/lib/db/public-restaurant';

export const metadata: Metadata = { title: 'Pricing · AutoDine', description: `Explore indicative AutoDine restaurant pricing and the ${TRIAL_DAYS}-day trial. Paid plans are not currently available.` };

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const params = await searchParams;
  const { s } = params;

  let address: string | undefined;
  let phone: string | undefined;
  if (s?.trim()) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data } = await readPublicRestaurant(supabase, s);
      address = data?.address ?? undefined;
      phone = data?.phone ?? undefined;
    }
  }

  return <PricingScreen address={address} phone={phone} />;
}
