import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmSubmit } from './ConfirmSubmit';

/**
 * The confirmation's safety property is in the first render.
 *
 * Everything else here needs a browser. What can be checked from the server's
 * markup -- and is the thing that would hurt most if it regressed -- is that the
 * button which renders first cannot submit the form. A one-click destructive
 * button with a confirmation *next* to it is not a confirmation.
 */
describe('ConfirmSubmit', () => {
  it('renders a non-submitting button until it is armed', () => {
    const html = renderToStaticMarkup(
      <ConfirmSubmit question="Revoke T3? Its printed card stops working.">Revoke</ConfirmSubmit>,
    );

    expect(html).toContain('>Revoke</button>');
    expect(html).toContain('type="button"');
    // The whole point: nothing here can submit the form yet.
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('Revoke T3?');
  });

  it('does not arm itself, or carry the server action, into the markup', () => {
    const html = renderToStaticMarkup(
      <ConfirmSubmit question="Revoke T3?" confirmLabel="Revoke it">
        Revoke
      </ConfirmSubmit>,
    );

    expect(html).not.toContain('Revoke it');
    expect(html).not.toMatch(/role="status"/);
  });
});
