import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { TRIAL_DAYS } from '@/lib/trial';

export const metadata: Metadata = {
  title: 'Terms · AutoDine',
  description: `Preview terms: the ${TRIAL_DAYS}-day trial, what is not available yet, and how orders and payments are handled.`,
};

/**
 * Keep this page aligned with the product's enforced behavior: the account
 * trial, counter-only guest ordering, and the currently unconfigured billing
 * provider boundary.
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
          A new account gets {TRIAL_DAYS} days on the whole product, measured from activation by the
          database&rsquo;s clock. No card is taken to start. The trial includes the product features
          available to the account. An existing account keeps its recorded trial end date; a policy
          change does not restart a trial that has already ended.
        </p>
        <p>
          When the account&rsquo;s recorded trial end date passes without an active plan, the account
          becomes read-only. New orders and edits are refused, while everything already recorded
          stays readable. Nothing is deleted, and the trial end date cannot be moved from a browser.
        </p>
      </LegalSection>

      <LegalSection title="Plans and prices">
        <p>
          The approved monthly prices are Starter ₹999, Professional ₹2,699 and Business ₹3,699. One
          subscription belongs to an account and is shared by its outlets. No payment provider is
          configured, so online plan checkout and automated charges are not available; this site does
          not charge for a plan.
        </p>
        <p>
          Plan entitlements and outlet limits are enforced by the server and database. A downgrade or
          expiry does not delete outlets or data; it prevents new outlet creation and may make the
          account read-only according to its subscription state.
        </p>
      </LegalSection>

      <LegalSection title="Orders">
        <p>
          An order is priced and written by the database, not by the browser. The guest sends dish
          identifiers and quantities; the price, tax rate and total are read from the restaurant&rsquo;s
          own rows when the order is saved. An order requires a live table session, which is what a
          scanned card plus the code shown in the room proves.
        </p>
        <p>
          That proves presence in the room, not identity. A guest who photographs the code can order
          from the card; the order is still tied to that table, and the kitchen still sees where it is
          going.
        </p>
      </LegalSection>

      <LegalSection title="Payments">
        <p>
          A guest&rsquo;s order is unpaid until a member of staff records the amount still owed. Cash,
          card and UPI are collected outside AutoDine at the counter; staff should verify that payment
          arrived before recording it. AutoDine does not process card details or verify a bank transfer.
        </p>
        <p>
          The customer app does not offer gateway checkout, display the restaurant&rsquo;s UPI QR, or
          accept a guest &ldquo;I have paid&rdquo; claim. Payment schema or database functions do not mean
          those customer flows are available. A payment arranged separately is between the guest, the
          restaurant and their payment provider or bank.
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
