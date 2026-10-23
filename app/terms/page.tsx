import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Terms · AutoDine',
  description: 'Preview terms: the seven-day trial, what is not for sale yet, and how orders and payments are actually handled.',
};

/**
 * The terms page.
 *
 * Short on purpose. Three things here are not boilerplate but the actual,
 * enforced behaviour of the product: a seven-day trial that ends in read-only,
 * plans that cannot be bought yet, and payments that are recorded by staff
 * rather than claimed by a browser. Each is backed by a migration this
 * repository ships.
 */
export default function TermsPage() {
  return (
    <LegalPage
      kicker="Terms"
      title="What this product promises, and what it does not."
      lede="AutoDine is in preview, preparing for its first restaurants. These terms describe how it behaves today — including the parts that are not finished."
    >
      <LegalSection title="The trial">
        <p>
          A new restaurant gets seven days on the whole product, measured from when the workspace was
          created, by the database&rsquo;s clock. No card is taken to start. It is not a cut-down
          version: menus, QR ordering, the kitchen board, the counter, reports and menu import are all
          on.
        </p>
        <p>
          When the seven days end without an active plan, the workspace becomes read-only. New orders
          are refused, and edits to menus and settings are refused, while everything already recorded
          stays readable. Nothing is deleted, and the trial is not silently extended. The start date
          cannot be moved from a browser.
        </p>
      </LegalSection>

      <LegalSection title="Plans and prices">
        <p>
          Starter ₹899, Professional ₹1,599 and Business ₹2,699 per month are planning figures. No plan
          can be bought on this site and nothing is charged. The feature split is written down (menu
          import and manager roles on Professional, several outlets on Business), but no restaurant is
          billed for it yet, and where a plan does not include a feature the server refuses it rather
          than hiding a button.
        </p>
      </LegalSection>

      <LegalSection title="Orders">
        <p>
          An order is priced and written by the database, not by the browser. The guest sends dish
          identifiers and quantities; the price, the tax and the total are read from the
          restaurant&rsquo;s own rows at the moment the order is saved. An order requires a live table
          session, which is what a scanned card plus the code shown in the room proves.
        </p>
        <p>
          That proves presence in the room, not identity. A guest who photographs the code can order
          from the card; the order is still tied to that table, and the kitchen still sees where it is
          going.
        </p>
      </LegalSection>

      <LegalSection title="Payments">
        <p>
          Counter payments are recorded by a member of staff, and only for the exact amount still owed.
          Card payments through a gateway are not enabled; the code exists but no gateway is connected
          and no restaurant can switch it on without deployment keys.
        </p>
        <p>
          A restaurant&rsquo;s own UPI QR is the restaurant&rsquo;s account, not AutoDine&rsquo;s. Scanning it
          does not mark an order paid: the guest&rsquo;s claim is stored as pending, and staff confirm the
          transfer before recording it. Any dispute about a UPI transfer is between the guest, the
          restaurant and their banks.
        </p>
      </LegalSection>

      <LegalSection title="Availability">
        <p>
          This is a preview, provided as it is. There is no uptime commitment, no support contract and
          no guarantee that a feature described on the marketing pages will not change. Before a
          restaurant relies on it for a service, it should be tested on that restaurant&rsquo;s own
          phones, tablets and network.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
