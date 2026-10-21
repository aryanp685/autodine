import type { Metadata } from 'next';
import { MenuEditorScreen } from '@/components/screens/MenuEditorScreen';
import { getMenuEditorData } from '@/lib/db/menu-editor';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = { title: 'Menu · AutoDine', robots: { index: false, follow: false } };

export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; item?: string; undo?: string }>;
}) {
  const { error, notice, item, undo } = await searchParams;

  // Null means Supabase is not configured: the screen renders its demo rows
  // and keeps every control inert rather than pretending to save.
  const [data, outlet] = await Promise.all([getMenuEditorData(), getOutletBar()]);

  return (
    <MenuEditorScreen
      data={data ?? undefined}
      outlet={outlet}
      selectedId={item}
      error={error}
      notice={notice}
      undo={undo}
    />
  );
}
