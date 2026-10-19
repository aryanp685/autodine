import type { AuthorizedWorkspace } from '@/lib/db/workspace-selection';

export function WorkspaceSwitcher({
  workspaces,
  selectedSlug,
  pathname,
}: {
  workspaces: AuthorizedWorkspace[];
  selectedSlug?: string;
  pathname: string;
}) {
  if (workspaces.length === 1 && selectedSlug === workspaces[0].slug) {
    const workspace = workspaces[0];
    return (
      <div className="workspace-switcher__single">
        <span className="workspace-switcher__label">Workspace</span>
        <strong>{workspace.name}</strong>
        <span className="workspace-switcher__role">{workspace.role}</span>
      </div>
    );
  }

  return (
    <form className="workspace-switcher" method="get" action={pathname}>
      <label htmlFor={`workspace-${pathname.replace(/\W/g, '-')}`} className="workspace-switcher__label">
        Workspace
      </label>
      <div className="workspace-switcher__controls">
        <select
          id={`workspace-${pathname.replace(/\W/g, '-')}`}
          name="workspace"
          defaultValue={selectedSlug ?? ''}
          className="workspace-switcher__select"
          required
        >
          <option value="" disabled>Choose a workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.slug}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
        <button type="submit" className="workspace-switcher__button">Switch</button>
      </div>
    </form>
  );
}
