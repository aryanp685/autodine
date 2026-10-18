import type { Metadata } from 'next';
import { Checkout } from '@/components/screens/CheckoutScreen';

export const metadata: Metadata = { title: 'Checkout · AutoDine' };

export default function CheckoutPage() {
  return <Checkout />;
}
