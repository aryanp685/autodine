import type { Metadata } from 'next';
import { Cart } from '@/components/screens/CartScreen';

export const metadata: Metadata = { title: 'Your order · AutoDine' };

export default function CartPage() {
  return <Cart />;
}
