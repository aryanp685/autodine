import type { Metadata } from 'next';
import { OrdersScreen, type OrderFilter } from '@/components/screens/OrdersScreen';
import { getReportsScreenData } from '@/lib/db/reports';
import { getOutletBar } from '@/lib/db/outlet-bar';

export const metadata: Metadata = { title: 'Orders · AutoDine', robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

function isOrderFilter(value: string | undefined): value is OrderFilter {
  return value === 'all' || value === 'open' || value === 'settled' || value === 'cancelled';
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; status?: string; q?: string }>;
}) {
  const { range, from, to, status, q } = await searchParams;

  // The ledger reads the same aggregate the sales report does: one definition
  // of "a bill", one place where a cancelled order is excluded from money.
  //
  // `from`/`to` are what a custom range is made of, and they are passed
  // through for the same reason the sales report passes them: the two screens
  // are the same aggregate over the same window, so a staff member who picked
  // 3–9 October on one should find the same week on the other. Before this the
  // ledger could only offer today, 7 days and 30 days.
  const [data, outlet] = await Promise.all([
    getReportsScreenData({ range: range ?? 'today', from, to }),
    getOutletBar(),
  ]);

  return (
    <OrdersScreen
      data={data}
      outlet={outlet}
      filter={isOrderFilter(status) ? status : 'all'}
      query={q ?? ''}
      customFrom={from}
      customTo={to}
    />
  );
}
