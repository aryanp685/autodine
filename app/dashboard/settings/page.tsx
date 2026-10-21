import type { Metadata } from 'next';
import { TaxSettingsScreen } from '@/components/screens/TaxSettingsScreen';
import { WorkspaceGate } from '@/components/WorkspaceGate';
import { getWorkspaceAccess } from '@/lib/db/workspace-access';
import { getSingleSearchParam } from '@/lib/query-params';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Settings · AutoDine', robots: { index: false, follow: false } };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string | string[]; status?: string | string[] }>;
}) {
  const { workspace: rawWorkspace, status: rawStatus } = await searchParams;
  const workspaceParam = getSingleSearchParam(rawWorkspace);
  const statusParam = getSingleSearchParam(rawStatus);
  const requestedSlug = workspaceParam.valid ? workspaceParam.value : '';
  const status = statusParam.valid ? statusParam.value : undefined;
  const access = await getWorkspaceAccess(requestedSlug);

  if (access.state === 'demo') {
    return (
      <main className="workspace-gate">
        <section className="workspace-gate__card">
          <span className="workspace-gate__eyebrow">Demo only</span>
          <h1>Tax settings</h1>
          <p>Connect an authenticated restaurant workspace to configure GST. Demo data is not saved, and no tax is added by default.</p>
        </section>
      </main>
    );
  }
  if (access.state !== 'selected') {
    return <WorkspaceGate access={access} pathname="/dashboard/settings" requestedSlug={requestedSlug} />;
  }

  const unavailable = () => <WorkspaceGate access={{ state: 'unavailable' }} pathname="/dashboard/settings" requestedSlug={requestedSlug} />;
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return unavailable();
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('tax_rate_bps')
      .eq('id', access.workspace.id)
      .maybeSingle();
    if (error || !restaurant) return unavailable();

    let canWrite: boolean | null = null;
    let writeAccessConfirmed = false;
    try {
      const result = await supabase.rpc('restaurant_can_write', {
        p_restaurant_id: access.workspace.id,
      });
      canWrite = result.data;
      writeAccessConfirmed = !result.error;
    } catch {
      writeAccessConfirmed = false;
    }

    const owner = access.workspace.role === 'owner';
    return (
      <TaxSettingsScreen
        workspace={access.workspace}
        workspaces={access.workspaces}
        taxRateBps={restaurant.tax_rate_bps}
        status={status}
        canEdit={owner && writeAccessConfirmed && canWrite === true}
        readOnly={writeAccessConfirmed && canWrite !== true}
        writeAccessUnavailable={!writeAccessConfirmed}
      />
    );
  } catch {
    return unavailable();
  }
}
