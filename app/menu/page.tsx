import type { Metadata } from 'next';
import { CustomerMenu } from '@/components/screens/CustomerMenu';

export const metadata: Metadata = { title: 'Order · AutoDine' };

export default function CustomerMenuPage() {
  return <CustomerMenu />;
}
