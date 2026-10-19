import Link from 'next/link';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import type { WorkspaceAccess } from '@/lib/db/workspace-access';

export function WorkspaceGate({
  access,
  pathname,
  headingOverride,
  messageOverride,
  requestedSlug,
}: {
  access: WorkspaceAccess;
  pathname: string;
  headingOverride?: string;
  messageOverride?: string;
  requestedSlug?: string;
}) {
  const heading = headingOverride ?? (access.state === 'choose'
    ? 'Choose a workspace'
    : access.state === 'unauthorized'
      ? 'Workspace unavailable'
      : access.state === 'none'
        ? 'No restaurant access'
        : access.state === 'sign-in'
          ? 'Sign in required'
          : 'Service unavailable');

  const message = messageOverride ?? (access.state === 'choose'
    ? 'You have access to more than one restaurant. Select one to continue.'
    : access.state === 'unauthorized'
      ? 'This workspace is not available to your account. Access may have changed; choose an authorized workspace.'
      : access.state === 'none'
        ? 'No restaurant workspace is linked to this account yet. Ask an owner to invite you.'
        : access.state === 'sign-in'
          ? 'Sign in to access a live workspace. Demo data is not shown as live data.'
          : 'The workspace could not be verified. Please retry; demo data will not be shown as a fallback.');

  const workspaces = 'workspaces' in access ? access.workspaces : [];
  const returnTo = requestedSlug
    ? `${pathname}?workspace=${encodeURIComponent(requestedSlug)}`
    : pathname;
  const loginHref = `/login?${new URLSearchParams({ next: returnTo }).toString()}`;

  return (
    <main className="workspace-gate" data-app>
      <section className="workspace-gate__card" aria-live="polite">
        <div className="workspace-gate__eyebrow">AutoDine · live access check</div>
        <h1>{heading}</h1>
        <p>{message}</p>
        {workspaces.length > 0 && (
          <WorkspaceSwitcher
            workspaces={workspaces}
            selectedSlug={access.state === 'selected' ? access.workspace.slug : undefined}
            pathname={pathname}
          />
        )}
        <div className="workspace-gate__links">
          <Link href={loginHref}>Sign in</Link>
          <Link href="/">Back to home</Link>
        </div>
      </section>
    </main>
  );
}
