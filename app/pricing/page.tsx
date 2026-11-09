import type { Metadata } from 'next';
import { PricingScreen } from '@/components/screens/PricingScreen';

export const metadata: Metadata = { title: 'Pricing · AutoDine', description: 'Explore indicative AutoDine restaurant pricing and the 7-day trial. Paid plans are not currently available.' };

export default function PricingPage() {
  return <PricingScreen />;
}
