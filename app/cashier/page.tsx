import type { Metadata } from 'next';
import { Cashier } from '@/components/screens/CashierScreen';

export const metadata: Metadata = { title: 'Counter · AutoDine' };

export default function CashierPage() {
  return <Cashier />;
}
