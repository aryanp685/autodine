import type { Metadata } from 'next';
import { PricingScreen } from '@/components/screens/PricingScreen';

export const metadata: Metadata = { title: 'Pricing · AutoDine' };

export default function PricingPage() {
  return <PricingScreen />;
}
