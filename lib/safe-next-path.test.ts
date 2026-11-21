import { describe, expect, it } from 'vitest';

import { safeLocalPath } from './safe-next-path';

/** The required matrix, then the crafty rest. */
describe('safeLocalPath', () => {
  const FALLBACK = '/dashboard';

  it('accepts the ordinary destinations the forms actually carry', () => {
    expect(safeLocalPath('/dashboard', FALLBACK)).toBe('/dashboard');
    expect(safeLocalPath('/dashboard/orders', FALLBACK)).toBe('/dashboard/orders');
    expect(safeLocalPath('/dashboard/orders?range=7d&status=open', FALLBACK)).toBe(
      '/dashboard/orders?range=7d&status=open',
    );
    expect(safeLocalPath('/menu?s=maddi', FALLBACK)).toBe('/menu?s=maddi');
  });

  it('rejects absolute URLs and scheme-relative hosts', () => {
    expect(safeLocalPath('https://evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('http://evil.example/dashboard', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('//evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('//evil.example/payload', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('mailto:a@b.c', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects backslash forms, raw and encoded', () => {
    expect(safeLocalPath('/\\evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/\\\\evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/%5cevil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/%5Cevil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/\\@evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/dashboard\\..\\evil', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects encoded and double-encoded scheme-relative values', () => {
    expect(safeLocalPath('/%2f%2fevil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/%2F%2Fevil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('https:%2f%2fevil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/%252f%252fevil.example', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects malformed and empty values', () => {
    expect(safeLocalPath('', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('   ', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('dashboard', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/%', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/%zz', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath(42 as unknown as string, FALLBACK)).toBe(FALLBACK);
  });

  it('rejects control characters — CR/LF in a Location header is response splitting', () => {
    expect(safeLocalPath('/dashboard\r\nSet-Cookie: pwned=1', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/dashboard%0d%0aSet-Cookie:%20pwned=1', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/dashboard%0a', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/dash\tboard', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/dash board', FALLBACK)).toBe(FALLBACK);
    expect(safeLocalPath('/\u0000nul', FALLBACK)).toBe(FALLBACK);
  });

  it('is fine with a percent-encoded character that stays a path character', () => {
    // One decode of a single-encoded value is allowed when the result is still
    // an ordinary path (`%20` in a path segment decodes to a space, which is
    // whitespace and therefore rejected — use `+` or nothing).
    expect(safeLocalPath('/menu?name=A%26B', FALLBACK)).toBe('/menu?name=A%26B');
    expect(safeLocalPath('/caf%C3%A9', FALLBACK)).toBe('/caf%C3%A9');
  });
});
