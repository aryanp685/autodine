/** Place-of-supply helper for reviewed local cases. Section 12(4) is where
 * the restaurant or catering service is actually performed. Do not infer
 * it from a buyer state or assume every delivery is local. */
export type PlaceOfSupplyInput = {
  /** Outlet state code from the GST configuration. */
  outletStateCode: string;
  /** Buyer identity only: never the source of POS, including inter-State cases. */
  recipientStateCode?: string | null;
  /** true when the supply itself is inter-state under its governing rule. */
  interState: boolean;
  /** Independently documented POS, needed before considering inter-State. */
  placeOfSupplyStateCode?: string;
};

export type PlaceOfSupply = { stateCode: string; interState: boolean; igstApplies: boolean };

export function determinePlaceOfSupply(input: PlaceOfSupplyInput): PlaceOfSupply {
  const outlet = String(input.outletStateCode ?? '').padStart(2, '0');
  if (!/^[0-9]{2}$/.test(outlet) || Number(outlet) < 1 || Number(outlet) > 38) {
    throw new Error('Place of supply: outlet state code is invalid — refusing to compute a tax split.');
  }
  if (input.interState) {
    const pos = input.placeOfSupplyStateCode;
    if (!pos || !/^(0[1-9]|[12][0-9]|3[0-8])$/.test(pos) || pos === outlet) {
      throw new Error('Inter-State place of supply needs independent evidence; buyer GSTIN state cannot decide it.');
    }
    return { stateCode: pos, interState: true, igstApplies: true };
  }
  return { stateCode: outlet, interState: false, igstApplies: false };
}

/** For display only. The database holds the authoritative channel snapshot. */
export const directFulfilmentLabel = (kind: unknown) => kind === 'direct_delivery' ? 'Direct delivery' : kind === 'takeaway' ? 'Takeaway' : null;
