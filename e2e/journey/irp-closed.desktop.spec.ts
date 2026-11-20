import { expect, test } from '@playwright/test';
import { d, staffContext } from './flow';

/**
 * The same screens in the normal production build: the synthetic IRP path is
 * closed, so an owner sees the register as read-only. This is the counterpart
 * to irp.simulation.spec.ts — the simulation is a rehearsal configuration, not
 * a shipped capability.
 */
test('production build: the IRP register is read-only and offers no provider controls', async ({ browser }) => {
  const context = await staffContext(browser, 'irp');
  try {
    const page = await context.newPage();
    await page.goto('/dashboard/reports/irp');
    await expect(page.getByRole('heading', { name: 'E-invoice / IRP register' })).toBeVisible();
    await expect(page.getByText('No live IRP is enabled.')).toBeVisible();
    await expect(page.getByText(/Read only\. Routing is managed by an entitled owner in an isolated local simulation/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save route' })).toHaveCount(0);
    await expect(page.getByLabel('Approved local route')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Validate IRP payload offline' })).toHaveCount(0);
    // The page states the outlet's recorded position without inventing a route.
    await expect(page.getByText('Journey Kitchen D · Selected outlet only')).toBeVisible();
    expect(d.slug).toBe('journey-outlet-d');
  } finally { await context.close(); }
});
