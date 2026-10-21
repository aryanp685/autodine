import type { Metadata } from 'next';
import { TablesScreen } from '@/components/screens/TablesScreen';
import { WorkspaceGate } from '@/components/WorkspaceGate';
import { getWorkspaceAccess } from '@/lib/db/workspace-access';
import { getSingleSearchParam } from '@/lib/query-params';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const metadata: Metadata = { title: 'Tables & QR · AutoDine', robots: { index: false, follow: false } };

export default async function TablesPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string | string[] }>;
}) {
  const { workspace: rawWorkspace } = await searchParams;
  const workspaceParam = getSingleSearchParam(rawWorkspace);
  const requestedSlug = workspaceParam.valid ? workspaceParam.value : '';
  const access = await getWorkspaceAccess(requestedSlug);
  if (access.state === 'demo') return <TablesScreen />;
  if (access.state !== 'selected') return <WorkspaceGate access={access} pathname="/dashboard/tables" requestedSlug={requestedSlug} />;

  const unavailable = () => <WorkspaceGate access={{ state: 'unavailable' }} pathname="/dashboard/tables" requestedSlug={requestedSlug} />;
  const admin = getSupabaseAdmin();
  if (!admin) return unavailable();

  try {
    const [{ data: tables, error: tablesError }, { data: canWrite, error: entitlementError }] = await Promise.all([
      admin
        .from('dining_tables')
        .select('id, label, seats, is_active')
        .eq('restaurant_id', access.workspace.id)
        .order('label', { ascending: true }),
      admin.rpc('restaurant_can_write', { p_restaurant_id: access.workspace.id }),
    ]);
    if (tablesError || !tables || entitlementError) return unavailable();

    let qrRows: Array<{ id: string; table_id: string; public_token: string; revoked_at: string | null }> = [];
    const canManage = access.workspace.role === 'owner' || access.workspace.role === 'manager';
    if (canManage) {
      const { data, error } = await admin
        .from('table_qr_codes')
        .select('id, table_id, public_token, revoked_at')
        .eq('restaurant_id', access.workspace.id)
        .order('created_at', { ascending: true });
      if (error || !data) return unavailable();
      qrRows = data;
    }

    const liveTables = tables.map((table) => ({
      ...table,
      qrCodes: qrRows.filter((qr) => qr.table_id === table.id),
    }));
    return (
      <TablesScreen
        workspace={access.workspace}
        workspaces={access.workspaces}
        liveTables={liveTables}
        canManageTables={canManage}
        canWriteTables={canWrite === true}
      />
    );
  } catch {
    return unavailable();
  }
}
