import type { Metadata } from 'next';
import { ReportsScreen } from '@/components/screens/ReportsScreen';
import { getReportsScreenData } from '@/lib/db/reports';

export const metadata: Metadata = { title: 'Reports · AutoDine', robots: { index: false, follow: false } };

// A money screen must never be served from a CDN cache: an owner refreshing
// after settling a table would otherwise see the takings from twenty minutes
// ago and have no way to know.
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { range, from, to } = await searchParams;

  // Null means Supabase is not configured: the screen then renders a labelled
  // sample report rather than an empty page that reads as a dead restaurant.
  const data = await getReportsScreenData({ range, from, to });

  return <ReportsScreen data={data} />;
}
