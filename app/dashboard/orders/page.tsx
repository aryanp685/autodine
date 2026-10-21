import type { Metadata } from 'next';
import { OrdersScreen, type OrderFilter } from '@/components/screens/OrdersScreen';
import { getReportsScreenData } from '@/lib/db/reports';

export const metadata: Metadata = { title: 'Orders · AutoDine', robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

function isOrderFilter(value: string | undefined): value is OrderFilter {
  return value === 'all' || value === 'open' || value === 'settled' || value === 'cancelled';
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; status?: string; q?: string }>;
}) {
  const { range, status, q } = await searchParams;

  // The ledger reads the same aggregate the sales report does: one definition
  // of "a bill", one place where a cancelled order is excluded from money.
  const data = await getReportsScreenData({ range: range ?? 'today' });

  return (
    <OrdersScreen
      data={data}
      filter={isOrderFilter(status) ? status : 'all'}
      query={q ?? ''}
    />
  );
}
