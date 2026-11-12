import type { Metadata } from 'next';
import { PricingScreen } from '@/components/screens/PricingScreen';
import { TRIAL_DAYS } from '@/lib/trial';

export const metadata: Metadata = { title: 'Pricing · AutoDine', description: `Explore indicative AutoDine restaurant pricing and the ${TRIAL_DAYS}-day trial. Paid plans are not currently available.` };

export default function PricingPage() {
  return <PricingScreen />;
}
