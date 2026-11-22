import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/database';
import type { RestaurantPrinter } from '@/lib/db/types';

export type PrinterSummary = {
  id: string;
  name: string;
  role: 'counter' | 'office' | 'bar' | 'other';
  printerType: 'thermal' | 'a4';
  connectionType: 'windows_bridge' | 'network_tcp' | 'browser_os';
  paperWidth: '58mm' | '80mm' | 'a4';
  bridgePrinterName: string | null;
  networkHost: string | null;
  networkPort: number | null;
  isDefault: boolean;
  autoPrintOnClose: boolean;
  status: 'connected' | 'offline' | 'untested';
  lastSeenAt: string | null;
  lastError: string | null;
};

export function toPrinterSummary(row: RestaurantPrinter): PrinterSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    printerType: row.printer_type,
    connectionType: row.connection_type,
    paperWidth: row.paper_width,
    bridgePrinterName: row.bridge_printer_name,
    networkHost: row.network_host,
    networkPort: row.network_port,
    isDefault: row.is_default,
    autoPrintOnClose: row.auto_print_on_close,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    lastError: row.last_error,
  };
}

/**
 * Loads logical printers configured for a restaurant.
 * Returns [] gracefully when the migration has not been applied yet on an
 * older database, so existing billing screens never fail to load.
 */
export async function loadRestaurantPrinters(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
): Promise<PrinterSummary[]> {
  try {
    const { data, error } = await supabase
      .from('restaurant_printers')
      .select(
        'id, restaurant_id, name, role, printer_type, connection_type, paper_width, bridge_printer_name, network_host, network_port, is_default, auto_print_on_close, status, last_seen_at, last_error, created_at, updated_at',
      )
      .eq('restaurant_id', restaurantId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return (data as RestaurantPrinter[]).map(toPrinterSummary);
  } catch {
    return [];
  }
}
