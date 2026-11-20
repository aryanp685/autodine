/** Ticket summaries. Monetary amounts come from saved orders; the separately
 * numbered invoice is the only GST document. */
import { BPS_PER_100_PERCENT, type Paise } from './money';
import type { GstMode } from './gst/profiles';

/* ---------------------------------------------------------------- the shape
   These types describe one bill. They live in this module, not in the
   database layer, because the bill screen is a client component and the
   database layer imports next/headers -- a client component that pulled in
   that module would drag server-only code into the browser bundle.
   ------------------------------------------------------------------------ */

export type BillLine = {
  id: string;
  /** Dish, portion and add-ons as one readable line. */
  label: string;
  qty: number;
  ratePaise: number;
  amountPaise: number;
  isVeg: boolean | null;
};

export type BillPayment = {
  method: string;
  amountPaise: number;
  /** Formatted in the restaurant's timezone. */
  at: string;
};

export type BillData = {
  restaurant: {
    name: string;
    address: string | null;
    phone: string | null;
  };
  order: {
    id: string;
    code: string;
    /** Formatted in the restaurant's timezone, e.g. "21 Oct 2026, 8:42 pm". */
    placedAt: string;
    tableLabel: string | null;
    prepStatus: string;
    paymentStatus: string;
    cancelled: boolean;
    customerNote: string | null;
    subtotalPaise: number;
    discountPaise: number;
    taxPaise: number;
    totalPaise: number;
    /** The rate this bill was taxed at; null on orders placed before 00600. */
    taxRateBps: number | null;
    gstMode: GstMode;
  };
  lines: BillLine[];
  payments: BillPayment[];
  outstandingPaise: number;
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'cash',
  card: 'card',
  upi: 'UPI',
  online: 'online payment',
  manual: 'manual settlement',
};

/** How a payment method is worded on a bill. */
export function paymentMethodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

/** Money as a bill writes it: ₹1,180.50, always two decimals. */
export function formatBillMoney(paise: Paise): string {
  const rupees = Math.abs(paise) / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);

  return `${paise < 0 ? '−' : ''}₹${formatted}`;
}

/** 1800 bps -> "18%", 500 -> "5%", 1250 -> "12.5%". No trailing zeros. */
export function formatTaxRate(bps: number): string {
  const percent = bps / 100;
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0$/, '');
  return `${text}%`;
}

/** Labels for the ticket summary and its WhatsApp message. No GST
 * decomposition or live tax registration is asserted on a ticket. */
export function ticketTaxLabel(mode: GstMode, rate: number | null): string {
  if (mode === 'composition') return 'GST collected';
  const label = mode === 'regular' ? 'GST included in this ticket' : 'Legacy tax';
  return rate == null ? label : `${label} (${formatTaxRate(rate)})`;
}

/** A bill line reads as one thing the guest can recognise. */
export function billLineLabel(line: { name: string; variant?: string | null; addons?: string[] }): string {
  const parts = [line.name.trim()];
  if (line.variant?.trim()) parts.push(line.variant.trim());
  if (line.addons?.length) parts.push(line.addons.map((a) => a.trim()).filter(Boolean).join(', '));
  return parts.filter(Boolean).join(' · ');
}

/**
 * A number a cashier typed, turned into something wa.me accepts.
 *
 * wa.me wants a country code and digits, nothing else. Indian numbers are
 * usually given as ten digits, or with a 0 in front, or already with +91. All
 * three are the same number; anything else is refused rather than guessed at,
 * because a bill sent to a stranger's phone is a real harm.
 */
export function toWhatsAppNumber(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '');

  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;

  return null;
}

export type BillMessageInput = {
  restaurantName: string;
  code: string;
  /** Already formatted in the restaurant's timezone. */
  placedAt: string;
  tableLabel: string | null;
  lines: { label: string; qty: number; amountPaise: Paise }[];
  subtotalPaise: Paise;
  discountPaise?: Paise;
  taxPaise: Paise;
  taxRateBps: number | null;
  gstMode: GstMode;
  totalPaise: Paise;
  /** "Paid by UPI at the counter" or "Not paid yet". */
  paymentLine: string;
};

/**
 * The bill as a WhatsApp message.
 *
 * WhatsApp bold is *asterisks*, not markdown, and the message is read on a
 * phone: short lines, the amount that matters at the bottom, and no table of
 * twelve columns. It says explicitly when a bill is unpaid, because a bill
 * that looks settled is how a restaurant loses money.
 */
export function buildBillMessage(input: BillMessageInput): string {
  const lines: string[] = [];

  lines.push(`*${input.restaurantName}*`);
  lines.push(`Order ticket ${input.code} — not a GST document`);
  lines.push(`${input.placedAt}${input.tableLabel ? ` · ${input.tableLabel}` : ' · Takeaway'}`);
  lines.push('');

  for (const line of input.lines) {
    lines.push(`${line.qty} × ${line.label} — ${formatBillMoney(line.amountPaise)}`);
  }

  lines.push('');
  const regular = input.gstMode === 'regular';
  lines.push(`${regular ? 'Menu subtotal (GST included)' : 'Subtotal'}: ${formatBillMoney(input.subtotalPaise)}`);

  if ((input.discountPaise ?? 0) > 0) {
    lines.push(`Discount: −${formatBillMoney(input.discountPaise ?? 0)}`);
  }

  if (input.taxPaise > 0 || input.gstMode !== 'off') {
    lines.push(`${ticketTaxLabel(input.gstMode, input.taxRateBps)}: ${formatBillMoney(input.taxPaise)}`);
  }

  lines.push(`*Total: ${formatBillMoney(input.totalPaise)}*`);
  lines.push('');
  lines.push(input.paymentLine);

  return lines.join('\n');
}

/** wa.me needs the message URL-encoded; kept here so callers cannot forget. */
export function whatsAppLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * The rate that was actually charged, worked out from the money itself.
 *
 * Orders placed before migration 00600 have no rate snapshot, and a bill has
 * to show a rate. Reading today's rate out of Settings would print whatever it
 * is now, which may not be what this bill charged. Deriving it from
 * tax ÷ taxable is arithmetic on the bill's own figures, so it cannot be
 * wrong -- only less precise, and it is rounded to the nearest quarter point,
 * which is the granularity Indian GST is set in (0.25%, 5%, 12%, 18%, 28%).
 */
export function deriveTaxRateBps(taxPaise: Paise, taxablePaise: Paise): number | null {
  if (taxPaise <= 0 || taxablePaise <= 0) return null;
  return Math.round((taxPaise * BPS_PER_100_PERCENT) / taxablePaise / 25) * 25;
}

/**
 * The rate a bill should print.
 *
 * The order's own snapshot wins, because that is the number the money was
 * computed with. Failing that, the rate is derived from the bill's own tax and
 * subtotal -- never taken from Settings, which may have changed since.
 */
export function billTaxRateBps(
  snapshot: number | null | undefined,
  taxPaise: Paise,
  taxablePaise: Paise
): number | null {
  if (typeof snapshot === 'number') return snapshot;
  return deriveTaxRateBps(taxPaise, taxablePaise);
}
