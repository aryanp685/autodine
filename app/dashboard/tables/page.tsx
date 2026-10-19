import type { Metadata } from 'next';
import { TablesScreen } from '@/components/screens/TablesScreen';

export const metadata: Metadata = { title: 'Tables & QR · AutoDine', robots: { index: false, follow: false } };

export default function TablesPage() {
  return <TablesScreen />;
}
