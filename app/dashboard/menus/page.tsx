import type { Metadata } from 'next';
import { MenuEditorScreen } from '@/components/screens/MenuEditorScreen';
import { WorkspaceGate } from '@/components/WorkspaceGate';
import { getWorkspaceAccess } from '@/lib/db/workspace-access';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = { title: 'Menu · AutoDine', robots: { index: false, follow: false } };

export default async function MenusPage({
  searchParams,
}: {
    searchParams: Promise<{ workspace?: string | string[] }>;
  }) {
  const { workspace: rawWorkspace } = await searchParams;
  const workspaceParam = getSingleSearchParam(rawWorkspace);
  const requestedSlug = workspaceParam.valid ? workspaceParam.value : '';
  const access = await getWorkspaceAccess(requestedSlug);
  if (access.state === 'demo') return <MenuEditorScreen />;
  if (access.state !== 'selected') return <WorkspaceGate access={access} pathname="/dashboard/menus" requestedSlug={requestedSlug} />;
  return <MenuEditorScreen workspace={access.workspace} workspaces={access.workspaces} />;
}
