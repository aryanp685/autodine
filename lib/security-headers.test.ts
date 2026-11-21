import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config.mjs';

describe('global response security headers', () => {
  it('sends the Permissions-Policy header on every route', async () => {
    const rules = await nextConfig.headers?.();
    const globalRule = rules?.find((rule) => rule.source === '/(.*)');
    const policy = globalRule?.headers.find((header) => header.key === 'Permissions-Policy');

    expect(policy?.value).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()',
    );
  });
});
