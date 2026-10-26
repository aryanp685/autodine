import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * What the Orders tab draws.
 *
 * These are server-render assertions, which is deliberately the weakest useful
 * thing: they prove the component asks for the status from the right place and
 * draws no claim before an answer exists. The behaviour that actually matters
 * -- backoff, overlap, visibility, terminal stop -- is in
 * lib/order-status-poller.test.ts, where it can be driven without a browser.
 */

vi.mock('@/lib/order-status-poller', () => ({
  createStatusPoller: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    pollNow: vi.fn(),
    getState: vi.fn(() => ({ phase: 'idle', failures: 0, lastOkAt: null })),
  })),
}));

import { GuestLiveStatus, readOrderStatus } from './GuestLiveStatus';

const TOKEN = '3f1c9f52-8f0e-4a5f-9a6b-2c1d4e5f6a7b';

function render(props: Partial<Parameters<typeof GuestLiveStatus>[0]> = {}) {
  return renderToStaticMarkup(
    <GuestLiveStatus slug="kings-of-kings" code="KI-ABC12" token={TOKEN} {...props} />,
  );
}

describe('before anything has been read', () => {
  it('says it is checking, and claims no status', () => {
    const html = render();

    expect(html).toContain('data-live-status="checking"');
    expect(html).toMatch(/Checking with the restaurant/i);
    // None of the six states may be claimed before the server says one.
    for (const claimed of ['Being cooked', 'Ready to serve', 'Served', 'Confirmed']) {
      expect(html).not.toContain(claimed);
    }
  });

  it('keeps the reference on screen while it checks', () => {
    // The reference is how the counter finds the bill when everything else is
    // broken, so it is never replaced by a spinner.
    expect(render()).toContain('KI-ABC12');
  });
});

describe('the request it makes', () => {
  it('posts all three credentials in the body, never in a URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          status: 'preparing',
          awaitingConfirmation: false,
          paymentStatus: 'pending',
          placedAt: '2026-10-26T10:00:00.000Z',
          checkedAt: '2026-10-26T10:01:00.000Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await readOrderStatus({ slug: 'kings-of-kings', code: 'KI-ABC12', token: TOKEN });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/menu/orders/status');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(String(init.body)).toContain(TOKEN);
    // The token must never end up in the address bar, history or Referer.
    expect(url).not.toContain(TOKEN);
    expect((result as { status?: string }).status).toBe('preparing');

    vi.unstubAllGlobals();
  });

  it('turns a failed read into a throw, so the poller backs off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })));
    await expect(
      readOrderStatus({ slug: 's', code: 'c', token: TOKEN }),
    ).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it('turns a malformed record into "not there", which stops the loop', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    expect(await readOrderStatus({ slug: 's', code: 'c', token: TOKEN })).toBeNull();
    vi.unstubAllGlobals();
  });

  it('treats an ok:false answer as "not there"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, reason: 'not_found' }))),
    );
    expect(await readOrderStatus({ slug: 's', code: 'c', token: TOKEN })).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('the copy', () => {
  it('does not promise a time', () => {
    const html = render();
    // A guest told "5 minutes" and still waiting in 20 is a guest who
    // distrusts everything else the product says.
    expect(html).not.toMatch(/\b\d+\s*(min|minute|minutes)\b/i);
  });

  it('is announced rather than only drawn', () => {
    const html = render();
    expect(html).toMatch(/aria-live="polite"/);
  });
});
