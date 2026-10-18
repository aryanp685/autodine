import type { Metadata } from 'next';
import { ItemSheet } from '@/components/screens/CustomerMenu';

export const metadata: Metadata = { title: 'Customise · AutoDine' };

export default function ItemPage() {
  return <ItemSheet />;
}
