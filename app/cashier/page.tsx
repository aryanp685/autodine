import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import { Cashier } from '@/components/screens/CashierScreen';
import { LiveCashierScreen } from '@/components/screens/LiveCashierScreen';
import { WorkspaceGate } from '@/components/WorkspaceGate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getWorkspaceAccess } from '@/lib/db/workspace-access';
import { mayUseCashier } from '@/lib/db/workspace-selection';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = {
  title: 'Counter · AutoDine',
  robots: { index: false, follow: false },
};

export default async function CashierPage({
  searchParams,
}: {
    searchParams: Promise<{ workspace?: string | string[]; error?: string | string[] }>;
  }) {
  const { workspace: rawWorkspace, error: rawError } = await searchParams;
  const workspaceParam = getSingleSearchParam(rawWorkspace);
  const errorParam = getSingleSearchParam(rawError);
  const requestedSlug = workspaceParam.valid ? workspaceParam.value : '';
  const error = errorParam.valid ? errorParam.value : undefined;
  const access = await getWorkspaceAccess(requestedSlug);
  if (access.state === 'demo') return <Cashier />;
  if (access.state !== 'selected') return <WorkspaceGate access={access} pathname="/cashier" requestedSlug={requestedSlug} />;

  if (!mayUseCashier(access.workspace.role)) {
    return (
      <WorkspaceGate
        access={access}
        pathname="/cashier"
        requestedSlug={requestedSlug}
        headingOverride="Cashier permission required"
        messageOverride="Kitchen access cannot create counter orders or collect payments. Select a workspace where your role is Owner, Manager, or Cashier."
      />
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return <WorkspaceGate access={{ state: 'unavailable' }} pathname="/cashier" requestedSlug={requestedSlug} />;

  try {
  const { data: orderRows, error: orderError } = await supabase
    .from('orders')
    .select('id, code, table_id, customer_note, payment_status, prep_status, total_paise, placed_at')
    .eq('restaurant_id', access.workspace.id)
    .eq('payment_status', 'pending')
    .neq('prep_status', 'cancelled')
    .order('placed_at', { ascending: false });
  if (orderError || !orderRows) return <WorkspaceGate access={{ state: 'unavailable' }} pathname="/cashier" requestedSlug={requestedSlug} />;

  const orderIds = orderRows.map((order) => order.id);
  const tableIds = [...new Set(orderRows.flatMap((order) => order.table_id ? [order.table_id] : []))];
  const [{ data: orderItems, error: itemsError }, { data: tableRows, error: tablesError }, { data: menuItems, error: menuError }] = await Promise.all([
    orderIds.length
      ? supabase.from('order_items').select('order_id, name_snapshot, qty, unit_price_paise').in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
    tableIds.length
      ? supabase.from('dining_tables').select('id, label').in('id', tableIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('items').select('id, name, price_paise, is_veg').eq('restaurant_id', access.workspace.id).eq('is_available', true).order('name'),
  ]);
  if (itemsError || tablesError || menuError || !orderItems || !tableRows || !menuItems) {
    return <WorkspaceGate access={{ state: 'unavailable' }} pathname="/cashier" requestedSlug={requestedSlug} />;
  }

  const tableLabels = new Map(tableRows.map((table) => [table.id, table.label]));
  const queue = orderRows.map((order) => ({
    id: order.id,
    code: order.code,
    tableLabel: order.table_id ? tableLabels.get(order.table_id) ?? 'Table' : 'Counter',
    customer_note: order.customer_note,
    total_paise: order.total_paise,
    placed_at_label: new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    }).format(new Date(order.placed_at)),
    items: orderItems.filter((item) => item.order_id === order.id),
  }));
  const paymentKeys = Object.fromEntries(queue.map((order) => [order.id, randomUUID()]));
  const allowedErrors = new Set(['access', 'permission', 'items', 'payment-input', 'read-only', 'amount', 'cancelled', 'already-paid', 'request']);

  return (
    <LiveCashierScreen
      key={access.workspace.id}
      workspace={access.workspace}
      workspaces={access.workspaces}
      menuItems={menuItems}
      orders={queue}
      paymentKeys={paymentKeys}
      error={error && allowedErrors.has(error) ? error : undefined}
    />
  );
  } catch {
    return <WorkspaceGate access={{ state: 'unavailable' }} pathname="/cashier" requestedSlug={requestedSlug} />;
  }
}
