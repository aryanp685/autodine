// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthField } from './AuthField';

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = async (ui: React.ReactNode) => {
  await act(async () => root.render(ui));
};

describe('AuthField', () => {
  it('keeps the name, label and autocomplete the server action depends on', async () => {
    await render(
      <AuthField
        id="login-password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />,
    );
    const input = host.querySelector('input[name="password"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('current-password');
    expect(input.required).toBe(true);
    expect(host.querySelector('label[for="login-password"]')?.textContent).toBe('Password');
  });

  it('reveals and re-hides a password without submitting the form', async () => {
    await render(<AuthField id="pw" name="password" label="Password" type="password" />);
    const input = host.querySelector('input') as HTMLInputElement;
    const toggle = host.querySelector('button') as HTMLButtonElement;

    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => toggle.click());
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Hide password');
    await act(async () => toggle.click());
    expect(input.type).toBe('password');
  });

  it('explains a missing required value instead of relying on a browser tooltip', async () => {
    await render(
      <AuthField
        id="email"
        name="email"
        label="Work email"
        type="email"
        required
        requiredMessage="Enter the email address you signed up with."
      />,
    );
    const input = host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new Event('invalid', { cancelable: true }));
    });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).toContain('Enter the email address you signed up with.');
  });

  it('shows the real server password rules and ticks them as they are met', async () => {
    await render(
      <AuthField id="pw" name="password" label="Password" type="password" minLength={10} showRequirements />,
    );
    const input = host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Correct-Horse9!');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('At least 10 characters');
    expect(host.textContent).toContain('An uppercase letter');
    expect(host.textContent).toContain('A number');
    expect(host.textContent).toContain('A special character');
    expect(host.querySelectorAll('li .bg-forest-soft').length).toBe(6);
  });
});
