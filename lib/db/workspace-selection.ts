import type { MemberRole } from './database';

export type AuthorizedWorkspace = {
  id: string;
  slug: string;
  name: string;
  role: MemberRole;
};

export type WorkspaceSelection =
  | { state: 'none'; workspaces: AuthorizedWorkspace[] }
  | { state: 'choose'; workspaces: AuthorizedWorkspace[] }
  | { state: 'unauthorized'; workspaces: AuthorizedWorkspace[] }
  | { state: 'selected'; workspace: AuthorizedWorkspace; workspaces: AuthorizedWorkspace[] };

/** Selects only from a server-supplied list of the current user's memberships. */
export function resolveWorkspaceSelection(
  workspaces: AuthorizedWorkspace[],
  requestedSlug?: string,
): WorkspaceSelection {
  if (workspaces.length === 0) return { state: 'none', workspaces };

  if (requestedSlug !== undefined) {
    const workspace = workspaces.find((candidate) => candidate.slug === requestedSlug);
    return workspace
      ? { state: 'selected', workspace, workspaces }
      : { state: 'unauthorized', workspaces };
  }

  if (workspaces.length === 1) {
    return { state: 'selected', workspace: workspaces[0], workspaces };
  }

  return { state: 'choose', workspaces };
}

/** Fail-closed environment decision: demo is possible only when config is absent. */
export function workspaceEnvironmentState(
  configured: boolean,
  userId: string | null,
  lookupFailed = false,
): 'demo' | 'sign-in' | 'unavailable' | 'live' {
  if (!configured) return 'demo';
  if (lookupFailed) return 'unavailable';
  if (!userId) return 'sign-in';
  return 'live';
}

export function mayUseCashier(role: MemberRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'cashier';
}
