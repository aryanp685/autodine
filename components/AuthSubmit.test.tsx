import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, useFormStatus: () => ({ pending: true }) };
});

import { AuthSubmit } from './AuthSubmit';

describe('AuthSubmit pending state', () => {
  it('shows the AutoDine brand loader and locks the submit action while pending', () => {
    const html = renderToStaticMarkup(
      <form>
        <AuthSubmit label="Create account" pendingLabel="Creating your workspace…" />
      </form>,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Creating your workspace…');
    expect(html).toContain('class="auth-brand-loader"');
    expect(html).toContain('auth-brand-loader__orbit');
    expect(html).not.toContain('>↗</span>');
  });
});
