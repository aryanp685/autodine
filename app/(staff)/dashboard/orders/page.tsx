import type { Metadata } from 'next';
import { OrdersScreen, type OrderFilter } from '@/components/screens/OrdersScreen';
import { getOrdersScreenData } from '@/lib/db/orders-ledger';
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

  // Owner and Manager rows come from the same report aggregate as the sales
  // report. Cashiers use a safe orders-only projection and never load payment
  // details or the finance CSV from this page. Both paths use this same window.
  const [data, outlet] = await Promise.all([
    getOrdersScreenData({ range: range ?? 'today', from, to }),
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
