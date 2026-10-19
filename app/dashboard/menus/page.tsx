import type { Metadata } from 'next';
import { MenuEditorScreen } from '@/components/screens/MenuEditorScreen';

export const metadata: Metadata = { title: 'Menu · AutoDine', robots: { index: false, follow: false } };

export default function MenusPage() {
  return <MenuEditorScreen />;
}
