import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';

import Layout from './layout';

describe('subscription route role boundary', () => {
  it('gates both subscription and receipt routes to Owner and Manager', () => {
    const child = <div>subscription content</div>;
    const gate = Layout({ children: child });

    expect(isValidElement(gate)).toBe(true);
    if (!isValidElement(gate)) throw new Error('expected the subscription route to render through RoleGate');
    expect(gate.props).toMatchObject({
      allow: ['owner', 'manager'],
      area: 'subscription',
      children: child,
    });
  });
});
