import type { Metadata } from 'next';
import { StatesScreen } from '@/components/screens/StatesScreen';

export const metadata: Metadata = { title: 'States, trial & subscription · AutoDine' };

export default function StatesPage() {
  return <StatesScreen />;
}
