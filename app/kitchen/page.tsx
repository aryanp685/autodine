import type { Metadata } from 'next';
import { Kitchen } from '@/components/screens/KitchenScreen';

export const metadata: Metadata = {
  title: 'Kitchen display · AutoDine',
  robots: { index: false, follow: false },
};

export default function KitchenPage() {
  return <Kitchen />;
}
