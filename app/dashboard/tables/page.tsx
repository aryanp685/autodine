import type { Metadata } from 'next';
import { TablesScreen } from '@/components/screens/TablesScreen';
import { WorkspaceGate } from '@/components/WorkspaceGate';
import { getWorkspaceAccess } from '@/lib/db/workspace-access';
import { getSingleSearchParam } from '@/lib/query-params';

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
  return <TablesScreen workspace={access.workspace} workspaces={access.workspaces} />;
}
