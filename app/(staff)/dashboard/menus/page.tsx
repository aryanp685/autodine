import type { Metadata } from 'next';
import { MenuEditorScreen } from '@/components/screens/MenuEditorScreen';
import { getMenuEditorData } from '@/lib/db/menu-editor';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = { title: 'Menu · AutoDine', robots: { index: false, follow: false } };

export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    notice?: string;
    item?: string;
    undo?: string;
    q?: string;
    show?: string;
    sort?: string;
  }>;
}) {
  // `q`, `show` and `sort` narrow the dish table. They are read here so the
  // screen stays a server component and the filter survives a reload.
  const { error, notice, item, undo, q, show, sort } = await searchParams;

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
      query={q}
      show={show}
      sort={sort}
    />
  );
}
