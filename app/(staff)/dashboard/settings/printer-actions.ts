'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { canEditSettings } from '@/lib/settings-input';

const SETTINGS_PRINTERS_PATH = '/dashboard/settings';

function fail(message: string): never {
  redirect(`${SETTINGS_PRINTERS_PATH}?error=${encodeURIComponent(message)}#settings-printers`);
}

function done(message: string): never {
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  revalidatePath('/cashier');
  redirect(`${SETTINGS_PRINTERS_PATH}?notice=${encodeURIComponent(message)}#settings-printers`);
}

export async function savePrinterAction(formData: FormData): Promise<void> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) fail('Sign in as an owner or manager to save printer settings.');
  if (!canEditSettings(staff.context.role)) {
    fail('Only an owner or manager can add or update printers.');
  }

  const printerIdRaw = String(formData.get('printerId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? 'counter').trim();
  const printerType = String(formData.get('printerType') ?? 'thermal').trim();
  const connectionType = String(formData.get('connectionType') ?? 'windows_bridge').trim();
  const paperWidth = String(formData.get('paperWidth') ?? '80mm').trim();
  const bridgePrinterName = String(formData.get('bridgePrinterName') ?? '').trim() || null;
  const networkHost = String(formData.get('networkHost') ?? '').trim() || null;
  const networkPortRaw = String(formData.get('networkPort') ?? '').trim();
  const networkPort = networkPortRaw ? Number.parseInt(networkPortRaw, 10) : null;
  const isDefault = formData.get('isDefault') === 'on' || formData.get('isDefault') === 'true';
  const autoPrintOnClose =
    formData.get('autoPrintOnClose') === 'on' || formData.get('autoPrintOnClose') === 'true';

  if (name.length < 2 || name.length > 60) {
    fail('Enter a printer name between 2 and 60 characters (for example, "Counter 80mm").');
  }
  if (connectionType === 'network_tcp' && !networkHost) {
    fail('Enter the LAN IP address or hostname for the network printer.');
  }
  if (networkPort != null && (!Number.isInteger(networkPort) || networkPort < 1 || networkPort > 65535)) {
    fail('Network printer port must be between 1 and 65535 (usually 9100).');
  }

  const { error } = await staff.context.supabase.rpc('upsert_restaurant_printer', {
    p_restaurant_id: staff.context.restaurantId,
    p_printer_id: printerIdRaw || null,
    p_name: name,
    p_role: role,
    p_printer_type: printerType,
    p_connection_type: connectionType,
    p_paper_width: paperWidth,
    p_bridge_printer_name: bridgePrinterName,
    p_network_host: networkHost,
    p_network_port: networkPort,
    p_is_default: isDefault,
    p_auto_print_on_close: autoPrintOnClose,
  });

  if (error) fail(error.message);
  done(`Saved printer "${name}".`);
}

export async function deletePrinterAction(formData: FormData): Promise<void> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) fail('Sign in as an owner or manager to remove printers.');
  if (!canEditSettings(staff.context.role)) {
    fail('Only an owner or manager can remove printers.');
  }

  const printerId = String(formData.get('printerId') ?? '').trim();
  if (!printerId) fail('Select a printer to remove.');

  const { error } = await staff.context.supabase.rpc('delete_restaurant_printer', {
    p_printer_id: printerId,
  });

  if (error) fail(error.message);
  done('Printer removed.');
}

export async function reportPrinterStatusAction(input: {
  printerId: string;
  status: 'connected' | 'offline' | 'untested';
  error?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) return { ok: false, error: 'Sign in required.' };

  const { error } = await staff.context.supabase.rpc('record_restaurant_printer_status', {
    p_printer_id: input.printerId,
    p_status: input.status,
    p_error: input.error ?? null,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard/settings');
  revalidatePath('/dashboard');
  revalidatePath('/cashier');
  return { ok: true };
}
