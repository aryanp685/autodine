/**
 * Adapter selection for e-Invoice (IRP) issuance.
 *
 * The environment is the ONLY place a provider is selected, and it is
 * fail-closed: without AUTODINE_IRP_PROVIDER explicitly set, no adapter
 * exists and every attempt refuses before touching the database. Today the
 * only implementation is the offline sandbox (provider id 'sandbox',
 * credential-free, no network). Naming any other provider is an explicit
 * error, not a fallback — wiring a live NIC/GSP adapter is an owner decision
 * and must ship as its own reviewed change.
 */

import { SandboxIrpAdapter, SANDBOX_PROVIDER_ID } from './irp/sandbox';
import type { IrpAdapter } from './irp/types';

export type IrpAdapterResolution =
  | { ok: true; adapter: IrpAdapter }
  | { ok: false; error: string };

export function getIrpAdapter(env: NodeJS.ProcessEnv = process.env): IrpAdapterResolution {
  const provider = env.AUTODINE_IRP_PROVIDER?.trim();
  if (!provider) {
    return {
      ok: false,
      error: 'E-invoicing is not enabled on this deployment (AUTODINE_IRP_PROVIDER is unset). Nothing was attempted.',
    };
  }
  if (provider === SANDBOX_PROVIDER_ID) {
    return { ok: true, adapter: new SandboxIrpAdapter() };
  }
  return {
    ok: false,
    error: `Provider '${provider}' is not wired into this build. Only 'sandbox' (offline, credential-free) exists; a live NIC/GSP adapter needs the owner's explicit approval and reviewed code.`,
  };
}
