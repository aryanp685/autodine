import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Cashier } from './CashierScreen';

/* The counter is a client screen: it uses the router to re-read the queue
   after a write. Nothing here asserts navigation, so the router is stubbed. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/* The server actions reach lib/supabase/admin.ts through the action module.
   These tests render markup; they never call one. */
vi.mock('@/app/cashier/actions', () => ({ recordPaymentAction: async () => ({ ok: true }) }));
vi.mock('@/app/orders/actions', () => ({ cancelStaffOrderAction: async () => ({ ok: true }) }));

/**
 * The counter's three real defects, pinned so they cannot come back.
 *
 * 1. It had no navigation at all -- no bar, no sign-out, no way back.
 * 2. The queue could only ever settle its first row, because the detail panel
 *    was hard-wired to `visible[0]`. Every row is a button now.
 * 3. In demo mode the settle button was disabled with no explanation, so a
 *    preview queue could never be cleared. The button is live again and the
 *    copy says what it did (nothing).
 *
 * Plus the loader's `blocked` flag, which used to be returned and ignored, so
 * a signed-out visitor saw an empty counter and no reason for it.
 */

const nav = <header className="appBar">bar</header>;

describe('Cashier', () => {
  it('renders the bar it is handed by the server page', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    expect(html).toContain('appBar');
  });

  it('makes every ticket in the queue a real button', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    const rows = html.match(/data-counter-ticket="true"/g) ?? [];
    // The demo queue holds three counter tickets.
    expect(rows.length).toBe(3);
  });

  it('marks the oldest ticket as selected and no other', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    const pressed = html.match(/<button[^>]*data-counter-ticket[^>]*aria-pressed="true"/g) ?? [];
    expect(pressed.length).toBe(1);
    expect(html).toContain('A-1041');
  });

  it('leaves the preview settle button pressable', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    const cta = html.match(/<button[^>]*data-counter-cta[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(cta).toContain('Record cash ₹1,247');
    // `disabled:` also appears as a Tailwind variant in the class list, so the
    // attribute is what has to be absent -- not the word.
    expect(cta).not.toMatch(/\sdisabled=""/);
  });

  it('says the preview records nothing', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    expect(html).toContain('nothing is persisted');
  });

  it('explains a signed-out visitor instead of showing a quiet counter', () => {
    const html = renderToStaticMarkup(
      <Cashier nav={nav} data={{ restaurantName: '', queue: [], blocked: 'signed-out' }} />,
    );
    expect(html).toContain('Sign in to see this screen.');
    expect(html).not.toContain('data-counter-queue');
    expect(html).not.toContain('outstanding');
  });

  it('tells a member with no restaurant what is missing', () => {
    const html = renderToStaticMarkup(
      <Cashier nav={nav} data={{ restaurantName: '', queue: [], blocked: 'no-membership' }} />,
    );
    expect(html).toContain('No restaurant on this account yet.');
  });

  it('shows an empty live queue as empty rather than as sample data', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} data={{ restaurantName: 'Kabir', queue: [] }} />);
    expect(html).toContain('Queue clear');
    expect(html).not.toContain('A-1041');
  });

  it('opens on the bill the ledger handed over', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} focus="A-1038" />);
    const pressed = [...html.matchAll(/<button[^>]*data-counter-ticket[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => tag.includes('aria-pressed="true"'));
    expect(pressed).toHaveLength(1);
    // A-1038 is the second ticket in the sample queue, so the selection moved.
    expect(pressed[0]).toContain('A-1038');
  });

  it('says so when the bill it was handed is no longer waiting', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} focus="A-9999" />);

    expect(html).toContain('not waiting any more');
    expect(html).toContain('Got it');
    // It still shows a ticket, because a counter with no selection is unusable.
    expect(html).toContain('Record cash ₹1,247');
  });

  it('says nothing about a bill it was never handed', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} />);
    expect(html).not.toContain('not waiting any more');
  });
});

/**
 * A guest pressing "I have paid" against the shop's UPI QR is a claim, not
 * money -- the transfer happens in an app this product cannot see. The queue
 * row already said so; the panel that actually records the cash did not, and
 * that is the screen where collecting a paid bill twice can happen.
 */
describe('Cashier, the UPI claim', () => {
  const claimed = {
    restaurantName: 'Kabir',
    queue: [
      {
        id: 'order-1',
        code: 'K-9001',
        table: 'T4',
        at: '8:42 pm',
        state: 'Ready',
        total: 640,
        outstanding: 640,
        paid: 0,
        items: '2 × Thali',
        claimed: true,
      },
    ],
  };

  it('repeats the claim on the ticket being settled', () => {
    const html = renderToStaticMarkup(<Cashier nav={nav} data={claimed} />);

    expect(html).toContain('data-claim');
    expect(html).toContain('Guest says paid by UPI');
    expect(html).toContain('Check the restaurant');
  });

  it('says nothing about a claim that was never made', () => {
    const html = renderToStaticMarkup(
      <Cashier nav={nav} data={{ ...claimed, queue: [{ ...claimed.queue[0], claimed: false }] }} />,
    );

    expect(html).not.toContain('data-claim');
    expect(html).not.toContain('Guest says paid by UPI');
    expect(html).toContain('Record cash ₹640');
  });
});

/**
 * The counter after the 2026-10-24 pass.
 *
 * Two things were wrong here that a screenshot alone would not have caught:
 * the content column was offset by 232px against a rail that had become 244px
 * wide, so twelve pixels sat underneath it; and the button the whole screen
 * exists for was painted the same ink as a secondary action.
 */
describe('Counter, the redesign', () => {
  const html = () => renderToStaticMarkup(<Cashier nav={nav} />);

  it('clears the rail by its actual width', () => {
    // The foundation widened the rail to 244px. This screen writes its own
    // offset because its bar is rendered on the server, so it has to be pinned.
    expect(html()).toContain('lg:pl-[244px]');
    expect(html()).not.toContain('lg:pl-[232px]');
  });

  it('paints the settle action with the accent, because it is the reason the screen exists', () => {
    const doc = html();
    const at = doc.indexOf('data-counter-cta');
    const tag = doc.slice(doc.lastIndexOf('<button', at), doc.indexOf('>', at) + 1);

    expect(tag).toContain('bg-[var(--p-accent)]');
    expect(tag).not.toContain('bg-gink');
  });

  it('labels the queue row status with the same tag every other status uses', () => {
    const doc = html();
    const tile = doc.slice(doc.indexOf('data-counter-ticket'), doc.indexOf('</button>', doc.indexOf('data-counter-ticket')));

    expect(tile).toContain('rounded-full');
    expect(tile).toContain('Preparing');
  });

  it('says why the settle button is disabled on a ticket that cannot be paid', () => {
    const doc = renderToStaticMarkup(
      <Cashier
        nav={nav}
        data={{
          restaurantName: 'Kabir',
          queue: [
            // A live row with no id: the one case where the CTA is disabled
            // and the cashier cannot work out why.
            {
              code: 'K-1',
              table: 'T1',
              at: '8:00 pm',
              state: 'Ready',
              total: 100,
              outstanding: 100,
              paid: 0,
              items: '1 × Chai',
            } as never,
          ],
        }}
      />,
    );

    const at = doc.indexOf('data-counter-cta');
    const tag = doc.slice(doc.lastIndexOf('<button', at), doc.indexOf('>', at) + 1);
    expect(tag).toContain('disabled=""');
    expect(doc).toContain('arrived without an id');
  });

  it('draws its notices as the same strip the rest of the product uses', () => {
    const doc = renderToStaticMarkup(
      <Cashier
        nav={nav}
        data={{
          restaurantName: 'Kabir',
          queue: [
            {
              id: 'o-1',
              code: 'K-1',
              table: 'T1',
              at: '8:00 pm',
              state: 'Ready',
              total: 640,
              outstanding: 640,
              paid: 0,
              items: '2 × Thali',
              claimed: true,
            },
          ],
        }}
      />,
    );

    const at = doc.indexOf('data-claim');
    const from = doc.lastIndexOf('<div', at);
    const opening = doc.slice(from, doc.indexOf('>', from) + 1);
    expect(opening).toContain('rounded-[var(--p-r-block)]');
    expect(opening).not.toContain('rounded-full');
  });
});
