import { toValidatedInv01, type Inv01 } from './inv01';
import type { IrpPayloadV1 } from './types';

/** Pure offline validation. Does not manufacture acknowledgements, IRNs,
 * signatures, timestamps or QR artifacts. Never called a provider success. */
export function prepareOfflineIrp(payload: IrpPayloadV1): { ok: true; request: Inv01 } | { ok: false; error: string } {
  try { return { ok: true, request: toValidatedInv01(payload) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Invalid offline request.' }; }
}
