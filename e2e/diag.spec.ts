import { test } from '@playwright/test';
import { waitForAppReady } from './flow-helpers';

/**
 * TEMPORARY DIAGNOSTIC — DELETE BEFORE DELIVERY.
 *
 * The board's buttons are clicked by tests that report success and see no
 * state change. This presses one directly and reports what the element
 * carries (React marks, an onClick, a rect) and what the DOM click does,
 * so the next decision is made from facts instead of theories.
 */
test('DIAG kitchen button wiring', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 180));
  });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 260)}`));

  await page.goto('/kitchen');
  await waitForAppReady(page);

  const btn = page.getByRole('button', { name: 'Start preparing' }).first();
  const info = await btn.evaluate((el) => {
    const keys = Object.keys(el);
    const fiberKey = keys.find(
      (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
    );
    const propsKey = keys.find((k) => k.startsWith('__reactProps'));
    const props = propsKey ? (el as unknown as Record<string, unknown>)[propsKey] : null;
    return {
      marked: keys.filter((k) => k.startsWith('__')).slice(0, 6),
      fiber: Boolean(fiberKey),
      props: Boolean(propsKey),
      onClick: props ? typeof (props as { onClick?: unknown }).onClick : 'none',
      disabled: (el as HTMLButtonElement).disabled,
      rect: (el as HTMLElement).getBoundingClientRect().toJSON(),
    };
  });

  await btn.evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(500);
  const states = await page.locator('article[data-state]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-state')),
  );

  throw new Error(
    `DIAG info=${JSON.stringify(info)} domClickStates=${JSON.stringify(states)} console=${JSON.stringify(errors.slice(0, 6))}`,
  );
});
