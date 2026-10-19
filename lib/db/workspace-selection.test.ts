import { describe, expect, it } from 'vitest';
import {
  mayUseCashier,
  resolveWorkspaceSelection,
  workspaceEnvironmentState,
  type AuthorizedWorkspace,
} from './workspace-selection';

const workspaces: AuthorizedWorkspace[] = [
  { id: 'r-1', slug: 'north-cafe', name: 'North Cafe', role: 'owner' },
  { id: 'r-2', slug: 'south-cafe', name: 'South Cafe', role: 'cashier' },
];

describe('workspace selection', () => {
  it('requires a choice when a user belongs to multiple restaurants', () => {
    expect(resolveWorkspaceSelection(workspaces)).toMatchObject({ state: 'choose' });
  });

  it('switches only to a workspace present in the authorized membership list', () => {
    expect(resolveWorkspaceSelection(workspaces, 'south-cafe')).toMatchObject({
      state: 'selected',
      workspace: { id: 'r-2', slug: 'south-cafe', role: 'cashier' },
    });
  });

  it('auto-selects a sole workspace but rejects unknown or revoked workspace slugs', () => {
    expect(resolveWorkspaceSelection([workspaces[0]])).toMatchObject({
      state: 'selected',
      workspace: workspaces[0],
    });
    expect(resolveWorkspaceSelection(workspaces, 'not-a-member')).toMatchObject({ state: 'unauthorized' });
    expect(resolveWorkspaceSelection([])).toMatchObject({ state: 'none' });
  });
});

describe('demo/live gate', () => {
  it('serves demo only when Supabase is not configured', () => {
    expect(workspaceEnvironmentState(false, null)).toBe('demo');
    expect(workspaceEnvironmentState(true, null)).toBe('sign-in');
    expect(workspaceEnvironmentState(true, 'user-1')).toBe('live');
  });

  it('fails closed on failed auth/workspace lookups rather than silently switching to demo', () => {
    expect(workspaceEnvironmentState(true, 'user-1', true)).toBe('unavailable');
    expect(workspaceEnvironmentState(true, null, true)).toBe('unavailable');
  });

  it('allows cashier only for owner, manager, and cashier memberships', () => {
    expect(mayUseCashier('owner')).toBe(true);
    expect(mayUseCashier('manager')).toBe(true);
    expect(mayUseCashier('cashier')).toBe(true);
    expect(mayUseCashier('kitchen')).toBe(false);
  });
});
