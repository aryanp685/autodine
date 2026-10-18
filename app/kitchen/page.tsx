import type { Metadata } from 'next';
import { Kitchen } from '@/components/screens/KitchenScreen';

export const metadata: Metadata = { title: 'Kitchen display · AutoDine' };

export default function KitchenPage() {
  return <Kitchen />;
}
