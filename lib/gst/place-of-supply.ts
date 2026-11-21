/**
 * Place of supply for restaurant / catering / food services.
 *
 * Restaurant, catering and outdoor-catering services are tied to the location
 * of the restaurant itself (immovable establishment). The place of supply is
 * ALWAYS the outlet's state — an inter-state recipient (a guest from another
 * state, or even a B2B customer with a GSTIN elsewhere) does not move it.
 * Accordingly dine-in and takeaway bills are intra-state supplies taxed as
 * CGST + SGST (or as composition, where applicable).
 *
 * IGST arises only for a supply that is inter-State by its own rule — e.g. a
 * supply of goods delivered across state borders under a distinct service,
 * not ordinary restaurant service. The engine supports it explicitly so an
 * inter-state configuration cannot silently emit CGST/SGST.
 *
 * If an outlet's state code on the GST config ever disagrees with the state
 * code embedded in its GSTIN, the config is invalid — fail closed.
 */
export type PlaceOfSupplyInput = {
  /** Outlet state code from the GST configuration. */
  outletStateCode: string;
  /** Recipient (buyer) state code, when a B2B buyer GSTIN is captured. */
  recipientStateCode?: string | null;
  /** true when the supply itself is inter-state under its governing rule. */
  interState: boolean;
};

export type PlaceOfSupply = { stateCode: string; interState: boolean; igstApplies: boolean };

export function determinePlaceOfSupply(input: PlaceOfSupplyInput): PlaceOfSupply {
  const outlet = String(input.outletStateCode ?? '').padStart(2, '0');
  if (!/^[0-9]{2}$/.test(outlet) || Number(outlet) < 1 || Number(outlet) > 38) {
    throw new Error('Place of supply: outlet state code is invalid — refusing to compute a tax split.');
  }
  if (input.interState) {
    const pos = input.recipientStateCode ? String(input.recipientStateCode).padStart(2, '0') : null;
    if (pos && pos === outlet) {
      return { stateCode: outlet, interState: false, igstApplies: false };
    }
    return { stateCode: pos ?? outlet, interState: true, igstApplies: true };
  }
  return { stateCode: outlet, interState: false, igstApplies: false };
}
