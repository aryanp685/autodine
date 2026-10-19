import type { Metadata } from 'next';
import { MenuEditorScreen } from '@/components/screens/MenuEditorScreen';
import { getMenuEditorData } from '@/lib/db/menu-editor';

export const metadata: Metadata = { title: 'Menu · AutoDine', robots: { index: false, follow: false } };

export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; item?: string }>;
}) {
  const { error, notice, item } = await searchParams;

  // Null means Supabase is not configured: the screen renders its demo rows
  // and keeps every control inert rather than pretending to save.
  const data = await getMenuEditorData();

  return <MenuEditorScreen data={data ?? undefined} selectedId={item} error={error} notice={notice} />;
}
