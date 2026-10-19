import type { Metadata } from 'next';
import { Dashboard } from '@/components/screens/DashboardScreen';

export const metadata: Metadata = { title: 'Dashboard · AutoDine' };

export default function DashboardPage() {
  return <Dashboard />;
}
