'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { checkoutSessionAction, type CheckoutSessionResult } from '@/app/(staff)/dashboard/actions';
import { recordInvoiceReprintAction } from '@/app/(staff)/dashboard/invoice-print-actions';
import { reportPrinterStatusAction } from '@/app/(staff)/dashboard/settings/printer-actions';
import { btn } from '@/components/owner/chrome';
import type { PrinterSummary } from '@/lib/db/printers';
import {
  DEFAULT_BRIDGE_URL,
  readLocalBridgeConfig,
  sendToLocalPrintBridge,
  type PrintBridgeJob,
} from '@/lib/print-bridge';

type IssuedSuccess = Extract<CheckoutSessionResult, { ok: true }>;

export function CloseSessionButton({
  sessionId,
  table,
  outstandingPaise,
  gstMode = 'off',
  printers = [],
}: {
  sessionId: string;
  table: string;
  outstandingPaise: number;
  /** 'regular' enables the optional B2B buyer block (GST tax invoice). */
  gstMode?: 'off' | 'regular' | 'composition';
  printers?: PrinterSummary[];
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [buyer, setBuyer] = useState({ name: '', gstin: '', address: '', email: '' });
  const [issued, setIssued] = useState<IssuedSuccess | null>(null);
  const [printState, setPrintState] = useState<{
    status: 'printing' | 'printed' | 'failed';
    message: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  const autoPrinter = printers.find((p) => p.autoPrintOnClose) ?? null;

  const buyerActive =
    buyer.name.trim() !== '' || buyer.gstin.trim() !== '' || buyer.address.trim() !== '' || buyer.email.trim() !== '';

  if (outstandingPaise > 0) {
    return (
      <p role="note" className="max-w-[260px] text-right text-[10.5px] leading-[1.45] text-gink-46">
        Settle the outstanding balance before closing this table.
      </p>
    );
  }

  async function dispatchAutoPrint(job: PrintBridgeJob, outcome: IssuedSuccess) {
    if (!autoPrinter) {
      router.push(outcome.invoiceUrl);
      return;
    }
    if (autoPrinter.connectionType === 'browser_os') {
      router.push(outcome.invoiceUrl);
      return;
    }

    setPrintState({ status: 'printing', message: `Sending bill to ${autoPrinter.name}…` });
    const cfg = readLocalBridgeConfig();
    const res = await sendToLocalPrintBridge(
      {
        ...job,
        printerTarget: cfg.preferredPrinterName
          ? {
              ...job.printerTarget,
              bridgePrinterName: cfg.preferredPrinterName,
            }
          : job.printerTarget,
      },
      {
        endpoint: cfg.url || DEFAULT_BRIDGE_URL,
        token: cfg.token,
      },
    );

    void reportPrinterStatusAction({
      printerId: autoPrinter.id,
      status: res.ok ? 'connected' : 'offline',
      error: res.ok ? null : res.error,
    });

    if (res.ok) {
      void recordInvoiceReprintAction(outcome.invoiceId, 'escpos');
      const irpPrefix = outcome.irpStatus === 'generated' ? 'Registered & Printed' : 'Issued & Printed';
      setPrintState({
        status: 'printed',
        message: `${irpPrefix} (${autoPrinter.name}).`,
      });
    } else {
      setPrintState({
        status: 'failed',
        message: res.error,
      });
    }
  }

  function checkout() {
    if (inFlight.current) return;
    if (!confirm) {
      setConfirm(true);
      setError('');
      return;
    }
    inFlight.current = true;
    setError('');
    startTransition(async () => {
      const result = await checkoutSessionAction(
        sessionId,
        buyerActive
          ? { name: buyer.name, gstin: buyer.gstin, address: buyer.address, email: buyer.email }
          : undefined,
      );
      inFlight.current = false;
      if (!result.ok) {
        setError(result.error);
        setConfirm(false);
        return;
      }
      if (autoPrinter && result.printJob && autoPrinter.connectionType !== 'browser_os') {
        setIssued(result);
        setConfirm(false);
        await dispatchAutoPrint(result.printJob, result);
        return;
      }
      router.push(result.invoiceUrl);
    });
  }

  if (issued && printState) {
    const irpWarn =
      issued.irpStatus === 'failed'
        ? ` e-Invoice IRP registration failed (${issued.irpMessage ?? 'retry on invoice'}).`
        : '';
    return (
      <div className="flex w-full max-w-[290px] flex-col items-end gap-1.5 text-right">
        <div
          role="status"
          className={`w-full rounded-[var(--p-r-control)] border px-3 py-2 text-[11.5px] leading-[1.45] ${
            printState.status === 'failed'
              ? 'border-[var(--p-due)] bg-paper-deep text-[var(--p-due)]'
              : 'border-[var(--p-accent)] bg-paper-deep text-gink'
          }`}
        >
          <p className="m-0 font-semibold">{printState.message}</p>
          {irpWarn ? <p className="mt-1 mb-0 text-[10.5px] text-[var(--p-due)]">{irpWarn}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {printState.status === 'failed' && issued.printJob ? (
            <button
              type="button"
              className={btn('primary', 'sm')}
              onClick={() => void dispatchAutoPrint(issued.printJob!, issued)}
            >
              Retry print
            </button>
          ) : null}
          <Link href={issued.invoiceUrl} className={btn('ghost', 'sm')}>
            Open invoice
          </Link>
        </div>
      </div>
    );
  }

  const buyerBlock = gstMode === 'regular' && buyerOpen ? (
    <fieldset aria-label="B2B buyer details (optional)" className="mb-2 w-full rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-2.5 py-2 text-left">
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gink-46">Buyer (B2B, optional)</legend>
      <label className="block text-[10px] text-gink-46">Legal name
        <input className="mt-0.5 w-full rounded-[var(--p-r-control)] border border-hair bg-card px-1.5 py-1 text-[11.5px] text-gink" value={buyer.name} autoComplete="organization" onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} placeholder="Buyer Pvt Ltd" />
      </label>
      <label className="mt-1 block text-[10px] text-gink-46">GSTIN
        <input className="mt-0.5 w-full rounded-[var(--p-r-control)] border border-hair bg-card px-1.5 py-1 font-mono text-[11.5px] uppercase text-gink" value={buyer.gstin} autoComplete="off" maxLength={15} spellCheck={false} onChange={(e) => setBuyer({ ...buyer, gstin: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" />
      </label>
      <label className="mt-1 block text-[10px] text-gink-46">Billing address (optional)
        <input className="mt-0.5 w-full rounded-[var(--p-r-control)] border border-hair bg-card px-1.5 py-1 text-[11.5px] text-gink" value={buyer.address} autoComplete="street-address" onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} placeholder="Registered office, City" />
      </label>
      <label className="mt-1 block text-[10px] text-gink-46">Email (optional)
        <input className="mt-0.5 w-full rounded-[var(--p-r-control)] border border-hair bg-card px-1.5 py-1 text-[11.5px] text-gink" type="email" value={buyer.email} autoComplete="email" onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} placeholder="accounts@buyer.example" />
      </label>
    </fieldset>
  ) : null;

  const buyerToggle = gstMode === 'regular' ? (
    <button type="button" className="mb-1 text-[10px] font-medium text-gink-46 underline underline-offset-2" onClick={() => setBuyerOpen((open) => !open)} aria-expanded={buyerOpen}>
      {buyerOpen ? 'Hide buyer details' : 'Business buyer? Add GSTIN'}
    </button>
  ) : null;

  const toggle = confirm ? (
    <div role="group" aria-label={`Confirm checkout for ${table}`} className="max-w-[260px] rounded-[var(--p-r-control)] border border-hair bg-paper-deep px-3 py-2 text-right">
      <p className="text-[11.5px] leading-[1.45] text-gink-64">
        Close {table} and issue the final receipt? The receipt snapshots all tickets and payments.
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className={btn('quiet', 'sm')} onClick={() => setConfirm(false)} disabled={pending}>Keep open</button>
        <button type="button" className={btn('primary', 'sm')} onClick={checkout} disabled={pending}>
          {pending ? 'Closing…' : 'Close & issue'}
        </button>
      </div>
    </div>
  ) : (
    <>
      {buyerToggle}
      <button
        type="button"
        className={btn('ghost', 'sm')}
        onClick={checkout}
        disabled={pending}
        aria-label={`Close ${table} and issue final receipt`}
        data-checkout-session={sessionId}
      >
        Close & invoice
      </button>
    </>
  );

  return (
    <div className="flex w-full max-w-[260px] flex-col items-end gap-1.5">
      {buyerBlock}
      {toggle}
      {error ? <span role="alert" className="max-w-[260px] text-right text-[10.5px] text-[var(--p-due)]">{error}</span> : null}
    </div>
  );
}
