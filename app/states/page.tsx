import type { Metadata } from 'next';
import { StatesScreen } from '@/components/screens/StatesScreen';

export const metadata: Metadata = { title: 'States preview · AutoDine', robots: { index: false, follow: false } };

export default function StatesPage() {
  return <StatesScreen />;
}
