import type { Metadata } from 'next';
import { Dashboard } from '@/components/screens/DashboardScreen';
import { WorkspaceGate } from '@/components/WorkspaceGate';
import { getWorkspaceAccess } from '@/lib/db/workspace-access';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = {
  title: 'Dashboard · AutoDine',
  robots: { index: false, follow: false },
};

export default async function DashboardPage({
  searchParams,
}: {
    searchParams: Promise<{ workspace?: string | string[] }>;
  }) {
  const { workspace: rawWorkspace } = await searchParams;
  const workspaceParam = getSingleSearchParam(rawWorkspace);
  const requestedSlug = workspaceParam.valid ? workspaceParam.value : '';
  const access = await getWorkspaceAccess(requestedSlug);

  if (access.state === 'demo') return <Dashboard />;
  if (access.state !== 'selected') {
    return <WorkspaceGate access={access} pathname="/dashboard" requestedSlug={requestedSlug} />;
  }

  return <Dashboard workspace={access.workspace} workspaces={access.workspaces} />;
}
