import type { Metadata } from 'next';
import { TablesScreen } from '@/components/screens/TablesScreen';
import { getTablesScreenData } from '@/lib/db/tables-screen';

export const metadata: Metadata = { title: 'Tables & QR · AutoDine', robots: { index: false, follow: false } };

export default async function TablesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;

  // Null means Supabase is not configured: the screen then renders its own
  // sample floor plan, exactly as it did before the database existed.
  const data = await getTablesScreenData();

  return <TablesScreen data={data ?? undefined} error={error} notice={notice} />;
}
