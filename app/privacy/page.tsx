import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '@/components/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy · AutoDine',
  description: 'What AutoDine stores, what it never asks a guest for, and what happens to a restaurant’s data.',
};

/**
 * The privacy page.
 *
 * Written from the schema, not from a template: every paragraph below is true
 * of the tables in supabase/migrations. Where the product does not do something
 * (no guest account, no card data, no marketing email), it says so, because
 * that is the part a restaurant owner actually wants to know.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      kicker="Privacy"
      title="What we hold, and why."
      lede="AutoDine stores what a restaurant needs to run a service — its menu, its tables, its orders, and the payments its staff record. Guests are not asked to create an account, and card details never reach this software."
    >
      <LegalSection title="A guest ordering from a table">
        <p>
          No name, no phone number, no email, no account. The guest is identified by the table they
          are sitting at, which they prove with the code shown in the room, and by a single
          unguessable token that is placed in the link to their order.
        </p>
        <p>
          That token is what lets them see, change or cancel their own order. It is not printed, not
          read aloud, and not shared with any other order. Anyone without it cannot open the order,
          even with the short reference code.
        </p>
        <p>
          An order records: the dishes and their prices at the moment of ordering, the quantity, any
          add-ons, the table, the time, and the note the guest typed. If the restaurant asks for a
          special instruction (&ldquo;less spicy&rdquo;), that note is stored with the order and shown
          to the kitchen.
        </p>
      </LegalSection>

      <LegalSection title="A restaurant account">
        <p>
          Restaurants store the details they enter themselves: name, address, phone, GSTIN if they
          choose to, tax rate, menu, dish photographs, tables, staff memberships, and the payments
          their staff record. Passwords are handled by Supabase Auth and are never visible to the
          application.
        </p>
        <p>
          Each restaurant can only read and write its own rows. That is enforced in the database
          itself — row-level security — not only in the screens, so a hand-made request to another
          restaurant&rsquo;s data is refused by the server.
        </p>
      </LegalSection>

      <LegalSection title="Money">
        <p>
          AutoDine does not take card money today: no card gateway is connected, and no card number
          is ever typed into these pages. What is stored is a record of what staff collected at the
          counter — cash, card or UPI — written by the person who collected it.
        </p>
        <p>
          When a restaurant configures its own UPI ID, guests can scan that QR with the amount
          filled in. The money goes directly to the restaurant. If a guest presses &ldquo;I have
          paid&rdquo;, the software stores a pending claim, not a payment; staff confirm the transfer in
          their own bank app and then record it.
        </p>
      </LegalSection>

      <LegalSection title="What is never collected">
        <p>
          No guest accounts, no guest phone numbers, no advertising identifiers, and no third-party
          analytics or advertising scripts on the public pages. Dish photographs and logo files are
          stored in the restaurant&rsquo;s own folder in file storage.
        </p>
      </LegalSection>

      <LegalSection title="Retention, and what happens when a trial ends">
        <p>
          A restaurant&rsquo;s data stays for as long as the account exists. When a seven-day trial
          ends without a plan, the workspace becomes read-only: new orders and edits are refused,
          while menus, past orders, bills and reports stay readable. Nothing is deleted for
          non-payment.
        </p>
        <p>
          A restaurant that wants its data removed can ask for the account to be closed; the rows
          belonging to that restaurant are what would be removed.
        </p>
      </LegalSection>

      <LegalSection title="Questions">
        <p>
          This is a product preview preparing for its first restaurants. Questions about a specific
          restaurant&rsquo;s data should go to the person who set that restaurant&rsquo;s account up.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
