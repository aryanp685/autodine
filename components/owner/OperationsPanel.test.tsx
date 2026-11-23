import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperationsPanel } from './OperationsPanel';

/**
 * The disabled state is what the settings page passes when there is no
 * database behind the instance (demo, preview, unconfigured). It must not ask
 * the network, and it must not read like a healthy board.
 */
describe('OperationsPanel', () => {
  it('makes no claim and offers no retry when monitoring is unavailable', () => {
    const html = renderToStaticMarkup(<OperationsPanel disabled />);

    expect(html).toContain('Not available here');
    expect(html).toContain('Live incidents are not available in this environment.');
    expect(html).not.toContain('Nothing is open right now');
    expect(html).not.toContain('Refresh');
  });
});
