import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffShell } from './StaffShell';
import { Kitchen } from '@/components/screens/KitchenScreen';
import { Cashier } from '@/components/screens/CashierScreen';

/**
 * The shell is rendered once, and these are the two ways it used to be broken.
 *
 * 1. Every screen rendered its own rail. Since the staff layout now renders
 *    one, a screen that kept doing so would draw two -- which is not a
 *    hypothetical: it is what happens the moment somebody re-adds `OwnerPage`
 *    around a screen that is already inside the layout.
 * 2. The active section came from a prop, so a layout could not know it and a
 *    skeleton could forget it. It comes from the URL now, which is also what
 *    makes it correct after a client-side navigation the layout never sees.
 *
 * `renderToStaticMarkup` is the server pass, so `usePathname` is mocked to a
 * path rather than driven by a router. That is enough: the derivation is pure.
 */

const path = { current: '/kitchen' };

vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

vi.mock('@/app/(staff)/kitchen/actions', () => ({
  advanceOrderAction: async () => ({ ok: true, state: 'preparing' }),
  confirmTableAction: async () => ({ ok: true }),
  rejectTableAction: async () => ({ ok: true }),
}));

vi.mock('@/app/(staff)/cashier/actions', () => ({ recordPaymentAction: async () => ({ ok: true }) }));
vi.mock('@/app/orders/actions', () => ({ cancelStaffOrderAction: async () => ({ ok: true }) }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseBrowser: () => null }));

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('the staff shell', () => {
  it('draws the rail exactly once when a screen renders inside it', () => {
    const html = renderToStaticMarkup(
      <StaffShell outlet={null} signOut={false}>
        <Kitchen />
      </StaffShell>,
    );

    // One rail, one content column. A second of either is the double-frame bug.
    // (`lg:pl-[244px]` is deliberately NOT counted: the sticky top bar carries
    // the same offset so its content clears the rail, so it appears twice in a
    // correct render.)
    expect(count(html, 'id="app-rail"')).toBe(1);
    expect(count(html, '<main')).toBe(1);
    // And the board itself is still there.
    expect(html).toContain('Start preparing');
  });

  it('still draws the whole frame when a screen is rendered on its own', () => {
    // This is the unit-test / composed-by-hand path: no shell above it, so the
    // screen must supply the rail itself or it renders as bare content.
    const html = renderToStaticMarkup(<Kitchen />);
    expect(count(html, 'id="app-rail"')).toBe(1);
  });

  it('marks the section from the URL, not from a prop', () => {
    path.current = '/kitchen';
    const kitchen = renderToStaticMarkup(
      <StaffShell outlet={null} signOut={false}>
        <KüchenProbe />
      </StaffShell>,
    );
    expect(kitchen).toContain('data-nav="kitchen" data-nav-active="true"');

    path.current = '/dashboard/reports';
    const reports = renderToStaticMarkup(
      <StaffShell outlet={null} signOut={false}>
        <KüchenProbe />
      </StaffShell>,
    );
    expect(reports).toContain('data-nav="reports" data-nav-active="true"');
    expect(reports).not.toContain('data-nav="kitchen" data-nav-active="true"');
    // Width follows the same value: a report is wide, settings is not.
    expect(reports).toContain('max-w-[1380px]');
  });

  it('does not draw a second bar for the counter, which brings its own', () => {
    path.current = '/cashier';
    const html = renderToStaticMarkup(
      <StaffShell outlet={null} signOut={false}>
        <Cashier nav={<header className="appBar">bar</header>} />
      </StaffShell>,
    );

    // The page renders DashboardBar and hands it down as `nav`; inside the
    // shell that node is not rendered, so there is exactly one rail.
    expect(count(html, 'id="app-rail"')).toBe(1);
    expect(count(html, 'appBar')).toBe(0);
  });
});

/** A stand-in body: this suite is about the frame, not about any screen. */
function KüchenProbe() {
  return <p>content</p>;
}
