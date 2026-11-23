import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/(staff)/dashboard/actions', () => ({
  markSessionPaidAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { MarkSessionPaidButton } from './MarkSessionPaidButton';

const SESSION_ID = 'd220f1e4-f155-49b3-a56b-96b59ced7f50';

/**
 * The dashboard is where a manager settles a whole table in one tap, so the
 * markup contract matters: the method radios must exist and start unselected,
 * Mark paid must start disabled until a method is chosen ( enforced in the
 * component), and the actionable button keeps its data attribute for the
 * dashboard/E2E tooling.
 */
describe('MarkSessionPaidButton', () => {
  it('renders a method radio group with cash, card and upi, none preselected', () => {
    const html = renderToStaticMarkup(
      <MarkSessionPaidButton sessionId={SESSION_ID} table="T4" />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="How did the T4 guest pay?"');
    for (const method of ['cash', 'card', 'upi']) {
      expect(html).toContain(`data-mark-method="${method}"`);
    }
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(0);
  });

  it('starts Mark paid disabled and keeps the dashboard data attribute', () => {
    const html = renderToStaticMarkup(
      <MarkSessionPaidButton sessionId={SESSION_ID} table="T4" />,
    );

    expect(html).toContain(`data-mark-session-paid="${SESSION_ID}"`);
    expect(html).toContain('aria-label="Mark T4 paid"');
    expect(html).toMatch(/aria-label="Mark T4 paid"[^>]*disabled/);
  });

  it('does not render a UPI reference field until UPI is selected', () => {
    const html = renderToStaticMarkup(
      <MarkSessionPaidButton sessionId={SESSION_ID} table="T4" />,
    );
    expect(html).not.toContain('data-mark-upi-ref');
  });
});
