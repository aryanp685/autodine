import { dbErrorReference } from './error-reference';
import { readRowsForIds } from './paged-read';
import type { StaffContext } from './staff';

export type FloorSnapshot = {
  tables: { id: string; label: string; active: boolean; sitting: string | null; openedAt: string | null }[];
  calls: { id: string; tableId: string; table: string; createdAt: string; acknowledgedAt: string | null }[];
  canWork: boolean;
  tablesTruncated: boolean;
  callsTruncated: boolean;
};

export async function readFloorService(staff: Pick<StaffContext, 'supabase' | 'restaurantId'>) {
  const { data, error } = await staff.supabase.rpc('floor_service_snapshot', { p_outlet: staff.restaurantId });
  if (error || !data) return null;
  return data as FloorSnapshot;
}

export async function readOrderFloorLabels(supabase: StaffContext['supabase'], outlet: string, ids: string[]) {
  const { data, error } = await readRowsForIds(ids, batch => supabase.rpc('list_order_floor_labels', {
    p_outlet: outlet, p_orders: batch,
  }));
  if (error && !['42883', 'PGRST202'].includes(error.code ?? '')) {
    throw new Error(`Could not read service table labels: ${dbErrorReference(error)}`);
  }
  return new Map((data ?? []).map(row => [row.order_id, row.table_label]));
}
