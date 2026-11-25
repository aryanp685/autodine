// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthSubmissionOverlay } from './AuthSubmissionOverlay';

describe('auth submission overlay', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(() => {
    document.body.style.overflow = '';
    document.body.querySelectorAll('[data-auth-submit-overlay]').forEach((node) => node.remove());
  });

  it('shows the branded accessible progress veil only while submission is pending', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    await act(async () => {
      root.render(<AuthSubmissionOverlay open message="Signing in…" />);
    });

    const overlay = document.querySelector('[data-auth-submit-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('role')).toBe('status');
    expect(overlay?.getAttribute('aria-label')).toBe('Signing in…');
    expect(overlay?.textContent).toContain('Secure account hand-off');
    expect(overlay?.textContent).toContain('Signing in…');
    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      root.render(<AuthSubmissionOverlay open={false} message="Signing in…" />);
    });
    expect(document.querySelector('[data-auth-submit-overlay]')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    await act(async () => root.unmount());
    mount.remove();
  });
});
