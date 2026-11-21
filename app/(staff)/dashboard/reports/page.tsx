import type { Metadata } from 'next';
import { ReportsScreen } from '@/components/screens/ReportsScreen';
import { getReportsScreenData, resolveRange, type ReportRangeKey } from '@/lib/db/reports';
import { getOutletBar } from '@/lib/db/outlet-bar';

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
  const [data, outlet] = await Promise.all([
    getReportsScreenData({ range, from, to }),
    getOutletBar(),
  ]);

  /*
   * No database: the sample report still has to obey the window in the URL.
   * It used to be fixed at "last seven days", so the range chips changed the
   * address and nothing else — a control that did nothing on a screen that
   * claims to have none. `resolveRange` also clamps and swaps exactly as it
   * does for live data, so the sample cannot show a window the real one would
   * have refused.
   */
  const key: ReportRangeKey =
    range === 'today' || range === '7d' || range === '30d' || range === 'custom' ? range : '7d';
  const sampleRange = data
    ? undefined
    : resolveRange(key, 'Asia/Kolkata', new Date(), { from, to });

  return <ReportsScreen data={data} outlet={outlet} sampleRange={sampleRange} />;
}
