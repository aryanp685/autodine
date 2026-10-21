import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExpired, readTableSession } from './table-session';

/**
 * The table session arrives in a cookie, which is to say it arrives from a
 * browser the customer controls. Everything here is untrusted input.
 *
 * The reason to be strict is not that a forged cookie gets you far -- the
 * database re-checks the token on every order, and a forged one simply fails
 * there. It is that a malformed cookie should read as "no table" rather than
 * as an error, because a guest who never scanned anything sees this path too,
 * and they must not be shown a broken page for it.
 */

const mocks = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'autodine_table' && mocks.value !== undefined
        ? { name, value: mocks.value }
        : undefined,
  }),
}));

afterEach(() => {
  mocks.value = undefined;
});

const validToken = 'a'.repeat(64);

async function read(value: string | undefined) {
  mocks.value = value;
  return readTableSession();
}

describe('readTableSession', () => {
  it('reads a well-formed session', async () => {
    const session = await read(
      JSON.stringify({
        token: validToken,
        slug: 'maddi',
        tableLabel: 'T1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
    );

    expect(session).toEqual({
      token: validToken,
      slug: 'maddi',
      tableLabel: 'T1',
      expiresAt: expect.any(String),
    });
  });

  it('is simply absent when there is no cookie', async () => {
    // The common case: someone who opened a menu link without scanning.
    expect(await read(undefined)).toBeNull();
  });

  it('rejects a token that is not 64 hex characters', async () => {
    const base = { slug: 'maddi', tableLabel: 'T1', expiresAt: 'later' };

    expect(await read(JSON.stringify({ ...base, token: 'short' }))).toBeNull();
    expect(await read(JSON.stringify({ ...base, token: 'z'.repeat(64) }))).toBeNull();
    expect(await read(JSON.stringify({ ...base, token: 'a'.repeat(63) }))).toBeNull();
    expect(await read(JSON.stringify({ ...base, token: '' }))).toBeNull();
  });

  it('rejects a missing table label', async () => {
    const session = await read(
      JSON.stringify({
        token: validToken,
        slug: 'maddi',
        expiresAt: 'later',
      })
    );
    expect(session).toBeNull();
  });

  it('rejects an empty table label rather than showing a blank badge', async () => {
    const session = await read(
      JSON.stringify({
        token: validToken,
        slug: 'maddi',
        tableLabel: '   ',
        expiresAt: 'later',
      })
    );
    expect(session).toBeNull();
  });

  it('rejects a missing slug', async () => {
    const session = await read(
      JSON.stringify({ token: validToken, tableLabel: 'T1', expiresAt: 'later' })
    );
    expect(session).toBeNull();
  });

  it('is not fooled by a non-object', async () => {
    expect(await read('"just a string"')).toBeNull();
    expect(await read('42')).toBeNull();
    expect(await read('null')).toBeNull();
    expect(await read('[1,2,3]')).toBeNull();
  });

  it('survives a cookie that is not JSON', async () => {
    expect(await read('not json at all')).toBeNull();
    expect(await read('')).toBeNull();
  });

  it('rejects a token that is not a string', async () => {
    const session = await read(
      JSON.stringify({ token: 12345, slug: 'maddi', tableLabel: 'T1', expiresAt: 'x' })
    );
    expect(session).toBeNull();
  });
});

describe('isExpired', () => {
  const session = {
    token: validToken,
    slug: 'maddi',
    tableLabel: 'T1',
    expiresAt: '2026-10-21T10:00:00.000Z',
  };

  it('is live before the expiry', () => {
    expect(isExpired(session, new Date('2026-10-21T09:59:00Z'))).toBe(false);
  });

  it('is expired after it', () => {
    expect(isExpired(session, new Date('2026-10-21T10:00:01Z'))).toBe(true);
  });

  it('treats an unparseable date as expired', () => {
    // Safer to ask for a second scan than to seat someone at a table whose
    // session we cannot actually judge.
    expect(isExpired({ ...session, expiresAt: 'whenever' })).toBe(true);
  });
});
