export type KitchenKotData = {
  restaurantName: string;
  ticketCode: string;
  table: string;
  placedAt: string;
  note: string | null;
  items: Array<{
    quantity: number;
    name: string;
    portion: string | null;
    addons: string[];
  }>;
};

/** Escape every database-derived string before it enters the isolated print document. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export function buildKitchenKotHtml(ticket: KitchenKotData): string {
  const items = ticket.items.map((item) => {
    const instructions = [item.portion, ...item.addons].filter(Boolean).join(' · ');
    return `<li><span class="qty">${escapeHtml(String(item.quantity))}×</span><span><strong>${escapeHtml(item.name)}</strong>${instructions ? `<small>${escapeHtml(instructions)}</small>` : ''}</span></li>`;
  }).join('');
  const note = ticket.note?.trim()
    ? `<section class="note"><b>Note</b><p>${escapeHtml(ticket.note.trim())}</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KOT ${escapeHtml(ticket.ticketCode)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111; font: 13px/1.35 Arial, Helvetica, sans-serif; }
  main { width: 100%; }
  header { border-bottom: 1px dashed #555; padding-bottom: 9px; text-align: center; }
  h1 { margin: 0; font-size: 17px; line-height: 1.2; overflow-wrap: anywhere; }
  .kind { margin-top: 5px; font-size: 10px; font-weight: 700; letter-spacing: .12em; }
  .meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 9px; font-size: 11px; }
  .code { margin-top: 6px; font: 700 17px/1.2 monospace; }
  ul { display: grid; gap: 9px; margin: 11px 0 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 30px 1fr; gap: 7px; align-items: start; }
  .qty { font-size: 16px; font-weight: 700; text-align: right; }
  strong { font-size: 15px; overflow-wrap: anywhere; }
  small { display: block; margin-top: 2px; font-size: 12px; font-weight: 700; }
  .note { margin-top: 11px; border: 1px solid #777; padding: 7px; }
  .note b { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
  .note p { margin: 3px 0 0; font-size: 13px; overflow-wrap: anywhere; }
  footer { border-top: 1px dashed #555; margin-top: 11px; padding-top: 6px; text-align: center; font-size: 9px; }
  @media screen { body { max-width: 74mm; margin: 12px auto; padding: 8px; border: 1px solid #ccc; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(ticket.restaurantName)}</h1>
    <div class="kind">KITCHEN ORDER TICKET · KOT</div>
    <div class="code">${escapeHtml(ticket.ticketCode)}</div>
    <div class="meta"><span>Table <b>${escapeHtml(ticket.table)}</b></span><span>${escapeHtml(ticket.placedAt)}</span></div>
  </header>
  <ul>${items}</ul>
  ${note}
  <footer>Kitchen copy only · Not a customer invoice or payment receipt</footer>
</main>
</body>
</html>`;
}

/** Open an isolated browser print document. Returns false when popups are blocked. */
export function printKitchenKot(ticket: KitchenKotData): boolean {
  if (typeof window === 'undefined') return false;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(buildKitchenKotHtml(ticket));
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.requestAnimationFrame(() => {
    printWindow.focus();
    printWindow.print();
  });
  return true;
}
