import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { resolveWorkspaceSelection, workspaceEnvironmentState, type AuthorizedWorkspace } from './workspace-selection';

type SelectionAccess = ReturnType<typeof resolveWorkspaceSelection>;

export type WorkspaceAccess =
  | { state: 'demo' }
  | { state: 'sign-in' }
  | { state: 'unavailable' }
  | { state: 'none'; workspaces: AuthorizedWorkspace[] }
  | { state: 'choose'; workspaces: AuthorizedWorkspace[] }
  | { state: 'unauthorized'; workspaces: AuthorizedWorkspace[] }
  | { state: 'selected'; workspace: AuthorizedWorkspace; workspaces: AuthorizedWorkspace[] };

function asAccess(selection: SelectionAccess): WorkspaceAccess {
  return selection;
}

/**
 * Uses only the session client and RLS to construct the user's workspace list.
 * An invalid/stale selection never falls back to demo or another tenant.
 */
export async function getWorkspaceAccess(requestedSlug?: string): Promise<WorkspaceAccess> {
  if (!isSupabaseConfigured) return { state: 'demo' };
  try {
    return await loadWorkspaceAccess(requestedSlug);
  } catch {
    return { state: 'unavailable' };
  }
}

async function loadWorkspaceAccess(requestedSlug?: string): Promise<WorkspaceAccess> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { state: 'unavailable' };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const environment = workspaceEnvironmentState(true, authData.user?.id ?? null, Boolean(authError));
  if (environment === 'sign-in') return { state: 'sign-in' };
  if (environment !== 'live' || !authData.user) return { state: 'unavailable' };

  const { data: memberships, error: membershipError } = await supabase
    .from('memberships')
    .select('restaurant_id, role')
    .eq('user_id', authData.user.id);
  if (membershipError) return { state: 'unavailable' };
  if (!memberships?.length) return { state: 'none', workspaces: [] };

  const ids = [...new Set(memberships.map((membership) => membership.restaurant_id))];
  const { data: restaurants, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, slug, name')
    .in('id', ids);
  if (restaurantError || !restaurants || restaurants.length !== ids.length) {
    return { state: 'unavailable' };
  }

  const workspaces: AuthorizedWorkspace[] = memberships.flatMap((membership) => {
    const restaurant = restaurants.find((candidate) => candidate.id === membership.restaurant_id);
    return restaurant
      ? [{
          id: restaurant.id,
          slug: restaurant.slug,
          name: restaurant.name,
          role: membership.role,
        }]
      : [];
  });

  return asAccess(resolveWorkspaceSelection(workspaces, requestedSlug));
}

/** Re-check session and membership before every server-side mutation. */
export async function requireWorkspaceForAction(requestedSlug: string) {
  const access = await getWorkspaceAccess(requestedSlug);
  if (access.state !== 'selected') {
    throw new Error('Workspace authorization failed. Refresh the page and choose an authorized workspace.');
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error('Database connection is unavailable.');
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Sign-in is required.');

  return { supabase, userId: user.id, workspace: access.workspace };
}
