/**
 * Adapter selection for e-Invoice (IRP) issuance.
 *
 * The environment is the ONLY place a provider is selected, and it is
 * fail-closed: without AUTODINE_IRP_PROVIDER explicitly set, no adapter
 * exists and every attempt refuses before touching the database.
 */

import { NIC_GSP_PROVIDER_ID, NicGspIrpAdapter, resolveNicGspConfig } from './irp/nic-gsp';
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
  if (provider === NIC_GSP_PROVIDER_ID) {
    const resolved = resolveNicGspConfig(env);
    if (!resolved.ok) return resolved;
    return { ok: true, adapter: new NicGspIrpAdapter(resolved.config) };
  }
  return {
    ok: false,
    error: `Provider '${provider}' is not wired into this build. Supported providers: 'sandbox' or 'nic_gsp'.`,
  };
}
